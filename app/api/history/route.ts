import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/app/auth';
import logger from '@/app/utils/logger';
import { connectMongo } from '@/app/utils/mongodb';
import { JournalEntry } from '@/app/models/JournalEntry';

const log = logger;

export const runtime = 'nodejs';

function toApiEntry(doc: any) {
  return {
    id: doc._id,
    userId: doc.userId,
    entryText: doc.entryText,
    reflectionText: doc.reflectionText,
    summary: doc.summary ?? null,
    topic: doc.topic ?? null,
    mood: doc.mood ?? null,
    entities: doc.entities ?? null,
    highlights: doc.highlights ?? null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

export async function GET(request: NextRequest) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const mongo = await connectMongo();
  if (!mongo) return NextResponse.json({ error: 'Database not configured' }, { status: 500 });

  // Extract userId from NextAuth session (already hashed)
  let userId = session.user.id;

  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '0'); // 0 = no limit
    const offset = parseInt(searchParams.get('offset') || '0');

    log.debug(`GET /api/history - Fetching entries for user: ${userId}${limit > 0 ? ` (limit: ${limit}, offset: ${offset})` : ''}`);

    const query = JournalEntry.find({ userId }).sort({ createdAt: -1 });
    if (limit > 0) query.skip(offset).limit(limit);
    const docs = await query.lean();
    const entries = docs.map(toApiEntry);

    log.info(`Found ${entries.length} entries for user ${userId}`);
    return NextResponse.json({
      entries,
      ...(limit > 0 && {
        pagination: {
          limit,
          offset,
          hasMore: entries.length === limit, // Indicates there might be more entries
        }
      })
    });
  } catch (error: any) {
    log.error(`Failed to fetch history for user ${userId}`, { userId }, error);
    // Check if it's a timeout error
    const errorMessage = error?.message || 'Unknown error';
    const isTimeout = errorMessage.includes('timeout') || 
                      errorMessage.includes('Connection terminated') ||
                      error?.code === 'ETIMEDOUT' ||
                      error?.code === 'ECONNRESET';
    
    return NextResponse.json({ 
      error: 'Failed to fetch history', 
      message: isTimeout ? 'Connection terminated due to connection timeout' : errorMessage 
    }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const mongo = await connectMongo();
  if (!mongo) return NextResponse.json({ error: 'Database not configured' }, { status: 500 });

  // Extract userId from NextAuth session
  const userId = session.user.id;

  log.debug(`POST /api/history - Saving entries for user: ${userId}`);

  try {
    let body: any;
    try {
      body = await request.json();
    } catch (jsonError: any) {
      log.error('Failed to parse request body', {}, jsonError as Error);
      return NextResponse.json({
        error: 'Invalid JSON in request body',
        message: jsonError?.message || 'Failed to parse request body'
      }, { status: 400 });
    }

    const { entries } = body;

    if (!Array.isArray(entries)) {
      log.error('Invalid request body - entries is not an array', { receivedType: typeof entries });
      return NextResponse.json({
        error: 'Invalid request body',
        message: 'entries must be an array'
      }, { status: 400 });
    }

    log.info(`Received ${entries.length} entries to save for user ${userId}`);

    // Bulk upsert entries keyed by _id (UUID string).
    // SECURITY: ensure we never allow changing userId on an existing doc.
    const ops = entries.map((entryData: any) => {
      const createdAt = entryData.created_at ? new Date(entryData.created_at) : new Date();
      return {
        updateOne: {
          filter: { _id: entryData.id, userId },
          update: {
            $set: {
              entryText: entryData.entry_text,
              reflectionText: entryData.reflection_text,
              summary: entryData.summary || null,
              topic: entryData.topic || null,
              mood: entryData.mood ?? null,
              entities: entryData.entities || null,
              highlights: entryData.highlights || null,
            },
            $setOnInsert: {
              _id: entryData.id,
              userId,
              createdAt,
            },
          },
          upsert: true,
        },
      };
    });

    const result = await JournalEntry.bulkWrite(ops, { ordered: false });

    const saved =
      (result.upsertedCount || 0) +
      (result.modifiedCount || 0) +
      (result.matchedCount || 0);

    log.info(`Bulk upsert complete for user ${userId}`, {
      matched: result.matchedCount,
      modified: result.modifiedCount,
      upserted: result.upsertedCount,
    });

    return NextResponse.json({
      success: true,
      saved,
      skipped: 0,
    });
  } catch (error: any) {
    log.error('Failed to save entries', { userId }, error);
    // Check if it's a timeout error
    const errorMessage = error?.message || 'Unknown error';
    const isTimeout = errorMessage.includes('timeout') || 
                      errorMessage.includes('Connection terminated') ||
                      error?.code === 'ETIMEDOUT' ||
                      error?.code === 'ECONNRESET';

    // Ensure we return a properly serializable error response
    const errorCode = error?.code || 'UNKNOWN_ERROR';

    return NextResponse.json({
      error: 'Failed to save entries',
      message: isTimeout ? 'Connection terminated due to connection timeout' : errorMessage,
      code: errorCode,
      details: error?.meta ? { meta: error.meta } : undefined,
    }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const mongo = await connectMongo();
  if (!mongo) return NextResponse.json({ error: 'Database not configured' }, { status: 500 });

  // Extract userId from NextAuth session (already hashed)
  let userId = session.user.id;

  let entryId: string | null = null;
  try {
    const { searchParams } = new URL(request.url);
    entryId = searchParams.get('id');
    const deleteAll = searchParams.get('all') === 'true';

    if (deleteAll) {
      await JournalEntry.deleteMany({ userId });

      return NextResponse.json({ success: true });
    }

    if (!entryId) {
      return NextResponse.json({ error: 'Entry ID required' }, { status: 400 });
    }

    await JournalEntry.deleteOne({ _id: entryId, userId });

    return NextResponse.json({ success: true });
  } catch (error) {
    log.error('Failed to delete entry', { userId }, error as Error);
    return NextResponse.json({ error: 'Failed to delete entry' }, { status: 500 });
  }
}
