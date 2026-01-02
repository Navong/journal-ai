import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/app/auth';
import { prisma } from '@/app/utils/prisma';
// Migration will be imported dynamically if needed

/**
 * GET /api/history/audio?entryId=xxx&checkOnly=true
 * Fetch audio data for a specific journal entry
 * Used for on-demand audio loading (audio excluded from main history query for performance)
 * 
 * If checkOnly=true, only returns whether audio exists (doesn't fetch the actual audio data)
 */
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
  if (session.user.email && userId.startsWith('usr_')) {
    try {
      const { migrateUserDataByEmail } = await import('@/app/utils/userIdMigration');
      const migrationResult = await migrateUserDataByEmail(session.user.email, userId);
      if (migrationResult.entriesMigrated > 0 || migrationResult.preferencesMigrated) {
        console.log(`[Migration] Migrated data for ${session.user.email.substring(0, 5)}***: ${migrationResult.entriesMigrated} entries, preferences: ${migrationResult.preferencesMigrated}`);
      }
    } catch (migrationError) {
      console.error('[Migration] Failed to migrate user data by email', migrationError);
    }
  }

  try {
    const { searchParams } = new URL(request.url);
    const entryId = searchParams.get('entryId');
    const checkOnly = searchParams.get('checkOnly') === 'true';

    if (!entryId) {
      return NextResponse.json({ error: 'Entry ID required' }, { status: 400 });
    }

    if (checkOnly) {
      // Lightweight check: only verify if audio exists without fetching the data
      const entry = await prisma.journalEntry.findFirst({
        where: {
          id: entryId,
          userId: userId,
        },
        select: {
          audioData: true, // Select to check if it's null, but don't transfer the data
        },
      });

      if (!entry) {
        return NextResponse.json({ error: 'Entry not found or unauthorized' }, { status: 404 });
      }

      return NextResponse.json({
        exists: !!entry.audioData,
      });
    }

    // Fetch full audio data (only when user explicitly requests it)
    const entry = await prisma.journalEntry.findFirst({
      where: {
        id: entryId,
        userId: userId, // Security: ensure entry belongs to user
      },
      select: {
        audioData: true, // Only fetch audio data
      },
    });

    if (!entry) {
      return NextResponse.json({ error: 'Entry not found or unauthorized' }, { status: 404 });
    }

    if (!entry.audioData) {
      return NextResponse.json({ error: 'Audio not found for this entry' }, { status: 404 });
    }

    console.log(`[API] ✅ Fetched audio for entry ${entryId} (user: ${userId})`);
    return NextResponse.json({ audioData: entry.audioData });
  } catch (error: any) {
    console.error('[API] Failed to fetch audio:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch audio',
        message: error?.message || 'Unknown error',
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/history/audio
 * Save audio data for a specific journal entry
 * Used for async audio optimization and syncing
 */
export async function POST(request: NextRequest) {
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
        console.log(`[Migration] Migrated data for ${session.user.email.substring(0, 5)}***: ${migrationResult.entriesMigrated} entries, preferences: ${migrationResult.preferencesMigrated}`);
      }
    } catch (migrationError) {
      console.error('[Migration] Failed to migrate user data by email', migrationError);
    }
  }

  try {
    const body = await request.json();
    const { entryId, audioData } = body;

    if (!entryId) {
      return NextResponse.json({ error: 'Entry ID required' }, { status: 400 });
    }

    if (!audioData) {
      return NextResponse.json({ error: 'Audio data required' }, { status: 400 });
    }

    // Validate audio data format and length
    if (typeof audioData !== 'string') {
      return NextResponse.json({ error: 'Audio data must be a string' }, { status: 400 });
    }

    // Remove any whitespace
    const cleanedAudioData = audioData.replace(/\s/g, '');

    // Validate base64 format
    const base64Regex = /^[A-Za-z0-9+/]+=*$/;
    if (!base64Regex.test(cleanedAudioData)) {
      console.error('[API] Invalid base64 format in audio data', {
        length: cleanedAudioData.length,
        firstChars: cleanedAudioData.substring(0, 50)
      });
      return NextResponse.json({ error: 'Audio data is not valid base64' }, { status: 400 });
    }

    // Validate minimum length (audio data should be at least 1000 chars base64 = ~750 bytes)
    // Very short strings like "HFO7a4A=" (8 chars) are clearly invalid
    const MIN_AUDIO_LENGTH = 1000;
    if (cleanedAudioData.length < MIN_AUDIO_LENGTH) {
      console.error('[API] Audio data too short to be valid', {
        length: cleanedAudioData.length,
        expectedMin: MIN_AUDIO_LENGTH,
        data: cleanedAudioData.substring(0, 100)
      });
      return NextResponse.json(
        { 
          error: 'Audio data is too short to be valid',
          message: `Audio data must be at least ${MIN_AUDIO_LENGTH} characters, got ${cleanedAudioData.length}`
        }, 
        { status: 400 }
      );
    }

    // Verify entry belongs to user
    const entry = await prisma.journalEntry.findUnique({
      where: { id: entryId },
      select: { userId: true },
    });

    if (!entry) {
      return NextResponse.json({ error: 'Entry not found' }, { status: 404 });
    }

    if (entry.userId !== userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    // Update audio data (use cleaned version)
    await prisma.journalEntry.update({
      where: { id: entryId },
      data: { audioData: cleanedAudioData },
    });

    console.log(`[API] ✅ Saved audio for entry ${entryId} (user: ${userId}, size: ${cleanedAudioData.length} chars, ~${Math.round(cleanedAudioData.length * 0.75 / 1024)}KB)`);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[API] Failed to save audio:', error);
    return NextResponse.json(
      {
        error: 'Failed to save audio',
        message: error?.message || 'Unknown error',
      },
      { status: 500 }
    );
  }
}

