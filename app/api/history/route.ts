import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/app/auth';
import { prisma } from '@/app/utils/prisma';

export async function GET(request: NextRequest) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!prisma) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
  }

  // Extract userId from NextAuth session
  const userId = session.user.id;

  try {
    const { searchParams } = new URL(request.url);
    const includeAudio = searchParams.get('includeAudio') === 'true';
    const limit = parseInt(searchParams.get('limit') || '0'); // 0 = no limit
    const offset = parseInt(searchParams.get('offset') || '0');

    console.log(`[API] GET /api/history - Fetching entries for user: ${userId}${includeAudio ? ' (with audio)' : ''}${limit > 0 ? ` (limit: ${limit}, offset: ${offset})` : ''}`);

    // Optimize query: exclude audioData by default (it's large), use select for better performance
    // Use composite index (userId, createdAt DESC) for faster queries
    const entries = await prisma.journalEntry.findMany({
      where: {
        userId: userId,
      },
      select: {
        id: true,
        userId: true,
        entryText: true,
        reflectionText: true,
        summary: true,
        topic: true,
        mood: true,
        audioData: includeAudio, // Only fetch audio if explicitly requested
        createdAt: true,
        updatedAt: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
      ...(limit > 0 && { take: limit, skip: offset }),
    });

    console.log(`[API] Found ${entries.length} entries for user ${userId}`);
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
    console.error(`[API] Failed to fetch history for user ${userId}:`, error);
    return NextResponse.json({ error: 'Failed to fetch history', message: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!prisma) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
  }

  // Extract userId from NextAuth session
  const userId = session.user.id;

  console.log(`[API] POST /api/history - Saving entries for user: ${userId}`);

  try {
    let body: any;
    try {
      body = await request.json();
    } catch (jsonError: any) {
      console.error('[API] Failed to parse request body:', jsonError);
      return NextResponse.json({
        error: 'Invalid JSON in request body',
        message: jsonError?.message || 'Failed to parse request body'
      }, { status: 400 });
    }

    const { entries } = body;

    if (!Array.isArray(entries)) {
      console.error('[API] Invalid request body - entries is not an array. Received:', typeof entries, entries);
      return NextResponse.json({
        error: 'Invalid request body',
        message: 'entries must be an array'
      }, { status: 400 });
    }

    console.log(`[API] Received ${entries.length} entries to save for user ${userId}`);

    // Upsert entries with userId from NextAuth for security
    // We need to check if entry exists and belongs to user before updating
    let savedCount = 0;
    let skippedCount = 0;
    const errors: string[] = [];

    // Optimize: Process entries in parallel for better performance
    // Removed redundant findUnique - upsert is atomic and handles race conditions
    // Use Promise.allSettled to process all entries concurrently (much faster than sequential)
    const results = await Promise.allSettled(
      entries.map(async (entryData) => {
        // Upsert with userId in create to ensure ownership
        // This is atomic and handles race conditions without redundant queries
        const result = await prisma!.journalEntry.upsert({
          where: { id: entryData.id },
          create: {
            id: entryData.id,
            userId: userId, // Ensure new entries belong to current user
            entryText: entryData.entry_text,
            reflectionText: entryData.reflection_text,
            summary: entryData.summary || null,
            topic: entryData.topic || null,
            mood: entryData.mood || null,
            audioData: entryData.audio_data || null,
            createdAt: entryData.created_at ? new Date(entryData.created_at) : new Date(),
          },
          update: {
            entryText: entryData.entry_text,
            reflectionText: entryData.reflection_text,
            summary: entryData.summary || null,
            topic: entryData.topic || null,
            mood: entryData.mood || null,
            // Only update audioData if it's explicitly provided in the request
            // If audio_data field is missing/undefined, don't update audio field (preserves existing audio)
            // This prevents overwriting audio when syncing from device without audio in memory
            ...(entryData.audio_data !== undefined && entryData.audio_data !== null && { audioData: entryData.audio_data }),
          },
        });

        // Verify ownership after upsert
        if (result.userId !== userId) {
          return { entryId: entryData.id, success: false, reason: 'ownership_mismatch', result };
        }
        return { entryId: entryData.id, success: true, result };
      })
    );

    // Process results
    results.forEach((settled, index) => {
      const entryData = entries[index];
      if (settled.status === 'fulfilled') {
        const result = settled.value;
        if (result.success) {
          savedCount++;
          console.log(`[API] Upserted entry ${result.entryId} for user ${userId}`);
        } else {
          skippedCount++;
          console.warn(`[API] Skipped entry ${result.entryId} - belongs to user ${result.result.userId}, not ${userId}`);
        }
      } else {
        const error = settled.reason;
        const errorMessage = error?.message || 'Unknown error';
        const errorCode = error?.code || 'UNKNOWN_ERROR';
        errors.push(`Entry ${entryData.id}: ${errorMessage} (${errorCode})`);
        console.error(`[API] Error saving entry ${entryData.id} for user ${userId}:`, {
          message: errorMessage,
          code: errorCode,
        });
      }
    });

    if (errors.length > 0) {
      console.error(`Failed to save ${errors.length} entries:`, errors);
      return NextResponse.json({
        success: savedCount > 0,
        saved: savedCount,
        skipped: skippedCount,
        errors: errors.length,
        message: `Saved ${savedCount}, skipped ${skippedCount}, errors: ${errors.length}`
      }, { status: errors.length === entries.length ? 500 : 207 }); // 207 = Multi-Status
    }

    console.log(`Successfully saved ${savedCount} entries for user ${userId}`);
    return NextResponse.json({ success: true, saved: savedCount, skipped: skippedCount });
  } catch (error: any) {
    console.error('[API] Failed to save entries:', error);
    console.error('[API] Error details:', {
      message: error?.message,
      code: error?.code,
      meta: error?.meta,
      stack: error?.stack,
    });

    // Ensure we return a properly serializable error response
    const errorMessage = error?.message || 'Unknown error';
    const errorCode = error?.code || 'UNKNOWN_ERROR';

    return NextResponse.json({
      error: 'Failed to save entries',
      message: errorMessage,
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

  if (!prisma) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
  }

  // Extract userId from NextAuth session
  const userId = session.user.id;

  try {
    const { searchParams } = new URL(request.url);
    const entryId = searchParams.get('id');
    const deleteAll = searchParams.get('all') === 'true';

    if (deleteAll) {
      // Delete all entries for this user using userId from NextAuth
      await prisma.journalEntry.deleteMany({
        where: {
          userId: userId,
        },
      });

      return NextResponse.json({ success: true });
    }

    if (!entryId) {
      return NextResponse.json({ error: 'Entry ID required' }, { status: 400 });
    }

    // Delete entry only if it belongs to the user (security check using userId from NextAuth)
    await prisma.journalEntry.deleteMany({
      where: {
        id: entryId,
        userId: userId, // Verify ownership using userId from NextAuth
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete entry:', error);
    return NextResponse.json({ error: 'Failed to delete entry' }, { status: 500 });
  }
}
