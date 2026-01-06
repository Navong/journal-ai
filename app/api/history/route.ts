import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/app/auth';
import { prisma } from '@/app/utils/prisma';
import logger from '@/app/utils/logger';
import { normalizeUserId } from '@/app/utils/userIdMigration';

const log = logger;

export async function GET(request: NextRequest) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!prisma) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
  }

  // Extract userId from NextAuth session (already hashed)
  let userId = session.user.id;
  
  // Check if user has email in session and migrate old format data if needed
  // This handles users who had data stored with plain email IDs before the hash update
  if (session.user.email && userId.startsWith('usr_')) {
    try {
      const { migrateUserDataByEmail } = await import('@/app/utils/userIdMigration');
      const migrationResult = await migrateUserDataByEmail(session.user.email, userId);
      if (migrationResult.entriesMigrated > 0 || migrationResult.preferencesMigrated) {
        log.info(`[Migration] Migrated data for ${session.user.email.substring(0, 5)}***: ${migrationResult.entriesMigrated} entries, preferences: ${migrationResult.preferencesMigrated}`);
      }
    } catch (migrationError) {
      log.error('[Migration] Failed to migrate user data by email', { email: session.user.email?.substring(0, 5) + '***' }, migrationError as Error);
      // Continue with current userId even if migration fails
    }
  }

  try {
    const { searchParams } = new URL(request.url);
    const includeAudio = searchParams.get('includeAudio') === 'true';
    const limit = parseInt(searchParams.get('limit') || '0'); // 0 = no limit
    const offset = parseInt(searchParams.get('offset') || '0');

    log.debug(`GET /api/history - Fetching entries for user: ${userId}${includeAudio ? ' (with audio)' : ''}${limit > 0 ? ` (limit: ${limit}, offset: ${offset})` : ''}`);

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
        entities: true, // Include entities (people, places, events)
        highlights: true, // Include AI-detected highlights
        audioData: includeAudio, // Only fetch audio if explicitly requested
        audioS3Key: true, // Include S3 key for audio storage
        createdAt: true,
        updatedAt: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
      ...(limit > 0 && { take: limit, skip: offset }),
    });

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

  if (!prisma) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
  }

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
            mood: entryData.mood ?? null, // Save auto-detected mood (anxious, calm, etc.) or null if 'none'
            entities: entryData.entities || null, // Save extracted entities (people, places, events)
            highlights: entryData.highlights || null, // Save AI-detected highlights for UI
            audioData: entryData.audio_data || null,
            audioS3Key: entryData.audio_s3_key || null, // Save S3 key for audio storage
            createdAt: entryData.created_at ? new Date(entryData.created_at) : new Date(),
          },
          update: {
            entryText: entryData.entry_text,
            reflectionText: entryData.reflection_text,
            summary: entryData.summary || null,
            topic: entryData.topic || null,
            mood: entryData.mood ?? null, // Save auto-detected mood (anxious, calm, etc.) or null if 'none'
            entities: entryData.entities || null, // Update extracted entities
            highlights: entryData.highlights || null, // Update AI-detected highlights
            // Only update audioData if it's explicitly provided in the request
            // If audio_data field is missing/undefined, don't update audio field (preserves existing audio)
            // This prevents overwriting audio when syncing from device without audio in memory
            ...(entryData.audio_data !== undefined && entryData.audio_data !== null && { audioData: entryData.audio_data }),
            // Update S3 key if provided (even if null to allow clearing)
            ...(entryData.audio_s3_key !== undefined && { audioS3Key: entryData.audio_s3_key }),
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
          log.debug(`Upserted entry ${result.entryId} for user ${userId}`);
        } else {
          skippedCount++;
          log.warn(`Skipped entry ${result.entryId} - belongs to user ${result.result.userId}, not ${userId}`);
        }
      } else {
        const error = settled.reason;
        const errorMessage = error?.message || 'Unknown error';
        const errorCode = error?.code || 'UNKNOWN_ERROR';
        errors.push(`Entry ${entryData.id}: ${errorMessage} (${errorCode})`);
        log.error(`Error saving entry ${entryData.id} for user ${userId}`, {
          entryId: entryData.id,
          message: errorMessage,
          code: errorCode,
        }, error as Error);
      }
    });

    if (errors.length > 0) {
      log.error(`Failed to save ${errors.length} entries`, { errors, savedCount, skippedCount });
      return NextResponse.json({
        success: savedCount > 0,
        saved: savedCount,
        skipped: skippedCount,
        errors: errors.length,
        message: `Saved ${savedCount}, skipped ${skippedCount}, errors: ${errors.length}`
      }, { status: errors.length === entries.length ? 500 : 207 }); // 207 = Multi-Status
    }

    log.info(`Successfully saved ${savedCount} entries for user ${userId}`);
    return NextResponse.json({ success: true, saved: savedCount, skipped: skippedCount });
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

  if (!prisma) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
  }

  // Extract userId from NextAuth session (already hashed)
  let userId = session.user.id;
  
  // Check if user has email in session and migrate old format data if needed
  if (session.user.email && userId.startsWith('usr_')) {
    try {
      const { migrateUserDataByEmail } = await import('@/app/utils/userIdMigration');
      const migrationResult = await migrateUserDataByEmail(session.user.email, userId);
      if (migrationResult.entriesMigrated > 0 || migrationResult.preferencesMigrated) {
        log.info(`[Migration] Migrated data for ${session.user.email.substring(0, 5)}***: ${migrationResult.entriesMigrated} entries, preferences: ${migrationResult.preferencesMigrated}`);
      }
    } catch (migrationError) {
      log.error('[Migration] Failed to migrate user data by email', { email: session.user.email?.substring(0, 5) + '***' }, migrationError as Error);
    }
  }

  let entryId: string | null = null;
  try {
    const { searchParams } = new URL(request.url);
    entryId = searchParams.get('id');
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
    log.error('Failed to delete entry', { userId }, error as Error);
    return NextResponse.json({ error: 'Failed to delete entry' }, { status: 500 });
  }
}
