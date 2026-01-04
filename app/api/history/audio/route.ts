import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/app/auth';
import { prisma } from '@/app/utils/prisma';
import { generatePresignedUrl, isS3Configured, uploadAudio } from '@/app/utils/s3Service';
import { hashTTSInput } from '@/app/utils/textHash';
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
    const requestStartTime = Date.now();
    const { searchParams } = new URL(request.url);
    const entryId = searchParams.get('entryId');
    const checkOnly = searchParams.get('checkOnly') === 'true';
    const streaming = searchParams.get('streaming') === 'true';

    if (!entryId) {
      return NextResponse.json({ error: 'Entry ID required' }, { status: 400 });
    }

    console.log(`[API] [Performance] Starting audio fetch for entry ${entryId} (checkOnly: ${checkOnly}, streaming: ${streaming})`);

    if (checkOnly) {
      // Lightweight check: only verify if audio exists without fetching the data
      // Use findUnique for better performance (id is the primary key)
      const queryStartTime = Date.now();
      const entry = await prisma.journalEntry.findUnique({
        where: {
          id: entryId,
        },
        select: {
          audioData: true, // Select to check if it's null, but don't transfer the data
          userId: true, // Need userId for ownership verification
        },
      });
      const queryEndTime = Date.now();
      console.log(`[API] [Performance] Check query completed in ${queryEndTime - queryStartTime}ms`);

      if (!entry) {
        return NextResponse.json({ error: 'Entry not found or unauthorized' }, { status: 404 });
      }

      // Security: Verify entry belongs to user
      if (entry.userId !== userId) {
        return NextResponse.json({ error: 'Entry not found or unauthorized' }, { status: 404 });
      }

      return NextResponse.json({
        exists: !!entry.audioData,
      });
    }

    // Fetch full audio data (only when user explicitly requests it)
    // Use findUnique for better performance (id is the primary key)
    const queryStartTime = Date.now();
    const entry = await prisma.journalEntry.findUnique({
      where: {
        id: entryId,
      },
      select: {
        audioData: true, // Legacy audio data (backward compatibility)
        audioS3Key: true, // S3 key for new storage method
        reflectionText: true, // Need reflection text to generate S3 key
        userId: true, // Need userId for ownership verification
      },
    });
    const queryEndTime = Date.now();

    if (!entry) {
      console.log(`[API] [Performance] Entry not found after ${queryEndTime - queryStartTime}ms`);
      return NextResponse.json({ error: 'Entry not found or unauthorized' }, { status: 404 });
    }

    // Security: Verify entry belongs to user
    if (entry.userId !== userId) {
      console.log(`[API] [Performance] Unauthorized access attempt after ${queryEndTime - queryStartTime}ms`);
      return NextResponse.json({ error: 'Entry not found or unauthorized' }, { status: 404 });
    }

    // Check for S3 key first (new storage method)
    console.log(`[API] [Performance] Checking audio storage for entry ${entryId}: audioS3Key=${entry.audioS3Key ? 'present' : 'null'}, audioData=${entry.audioData ? `present (${(entry.audioData.length / 1024).toFixed(1)}KB)` : 'null'}, isS3Configured=${isS3Configured()}`);
    
    if (entry.audioS3Key && isS3Configured()) {
      const s3StartTime = Date.now();
      console.log(`[API] [Performance] [S3] ✅ Using S3 for entry ${entryId}: ${entry.audioS3Key}`);
      try {
        const urlStartTime = Date.now();
        const presignedUrl = await generatePresignedUrl(entry.audioS3Key);
        const urlTime = Date.now() - urlStartTime;
        console.log(`[API] [Performance] [S3] Generated pre-signed URL in ${urlTime}ms`);
        
        if (streaming) {
          // For streaming mode, fetch from S3 and stream to client
          const fetchStartTime = Date.now();
          console.log(`[API] [Performance] [S3] Fetching audio stream from S3...`);
          const s3Response = await fetch(presignedUrl);
          const fetchTime = Date.now() - fetchStartTime;
          
          if (s3Response.ok && s3Response.body) {
            const totalTime = Date.now() - s3StartTime;
            console.log(`[API] [Performance] [S3] ✅ Audio stream from S3 for entry ${entryId} (total: ${totalTime}ms, fetch: ${fetchTime}ms)`);
            return new Response(s3Response.body, {
              headers: {
                'Content-Type': 'audio/wav',
                'Cache-Control': 'public, max-age=31536000',
              },
            });
          } else {
            console.error(`[API] [Performance] [S3] ❌ S3 fetch failed: status ${s3Response.status}`);
            throw new Error(`S3 fetch failed: ${s3Response.status}`);
          }
        } else {
          // For JSON mode, return S3 URL
          const totalTime = Date.now() - s3StartTime;
          console.log(`[API] [Performance] [S3] ✅ Returning S3 URL for entry ${entryId} (total: ${totalTime}ms)`);
          return NextResponse.json({ 
            audioS3Url: presignedUrl,
            audioS3Key: entry.audioS3Key 
          });
        }
      } catch (error) {
        const totalTime = Date.now() - s3StartTime;
        console.error(`[API] [Performance] [S3] ❌ Failed to fetch from S3 after ${totalTime}ms, falling back to audioData:`, error);
        // Fall through to audioData fallback
      }
    } else {
      if (entry.audioS3Key && !isS3Configured()) {
        console.log(`[API] [Performance] ⚠️ Entry has audioS3Key but S3 not configured, falling back to audioData`);
      } else if (!entry.audioS3Key) {
        console.log(`[API] [Performance] ⚠️ Entry has no audioS3Key, using audioData fallback`);
      }
    }

    // Fallback to audioData (backward compatibility)
    console.log(`[API] [Performance] Using audioData fallback for entry ${entryId}`);
    if (!entry.audioData) {
      console.log(`[API] [Performance] No audio data found after ${queryEndTime - queryStartTime}ms`);
      return NextResponse.json({ error: 'Audio not found for this entry' }, { status: 404 });
    }

    const audioSize = entry.audioData.length;

    // Decode base64 to binary (needed for both streaming and S3 upload)
    const decodeStartTime = Date.now();
    const binaryString = atob(entry.audioData);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const decodeEndTime = Date.now();

    // Upload to S3 in the background if S3 is configured and we have reflection text
    // This migrates old audioData to S3 for future use
    if (isS3Configured() && entry.reflectionText && !entry.audioS3Key) {
      (async () => {
        try {
          const uploadStartTime = Date.now();
          console.log(`[API] [Migration] Starting background S3 upload for entry ${entryId}...`);
          
          // Generate S3 key using reflection text (same as TTS generation)
          const voiceId = process.env.CARTESIA_VOICE_ID || '694f9389-aac1-45b6-b726-9d9369183238';
          const textHash = hashTTSInput(entry.reflectionText, voiceId);
          const s3Key = `audio/${userId}/${textHash}.wav`;
          
          console.log(`[API] [Migration] Generated S3 key: ${s3Key} for entry ${entryId}`);
          
          // Upload to S3
          await uploadAudio(bytes, s3Key);
          
          // Save S3 key to database
          try {
            await prisma.journalEntry.update({
              where: { id: entryId },
              data: { audioS3Key: s3Key },
            });
            const uploadTime = Date.now() - uploadStartTime;
            console.log(`[API] [Migration] ✅ Migrated audio to S3 for entry ${entryId} (${s3Key}) in ${uploadTime}ms`);
          } catch (dbError: any) {
            // Handle P2025 (record not found) gracefully
            if (dbError.code === 'P2025') {
              console.warn(`[API] [Migration] ⚠️ Entry ${entryId} not found when saving S3 key (may have been deleted)`);
            } else {
              throw dbError;
            }
          }
        } catch (uploadError) {
          console.error(`[API] [Migration] ❌ Failed to migrate audio to S3 for entry ${entryId}:`, uploadError);
          // Don't throw - this is background migration, shouldn't affect user experience
        }
      })();
    }

    // If streaming=true, return audio as binary stream instead of JSON
    // This avoids JSON serialization overhead (saves ~1-2 seconds)
    if (streaming) {
      const totalTime = decodeEndTime - requestStartTime;
      console.log(`[API] [Performance] ✅ Audio streaming completed in ${totalTime}ms (query: ${queryEndTime - queryStartTime}ms, decode: ${decodeEndTime - decodeStartTime}ms, size: ${(audioSize / 1024).toFixed(0)}KB → ${(bytes.length / 1024).toFixed(0)}KB binary)`);

      // Return as binary stream (WAV format for progressive decoding)
      return new Response(bytes, {
        headers: {
          'Content-Type': 'audio/wav', // WAV audio (allows progressive decoding)
          'Content-Length': String(bytes.length),
          'Cache-Control': 'public, max-age=31536000', // Cache for 1 year
        },
      });
    }

    // Default: return as JSON (for backward compatibility)
    const serializeStartTime = Date.now();
    const response = NextResponse.json({ audioData: entry.audioData });
    const serializeEndTime = Date.now();
    const totalTime = serializeEndTime - requestStartTime;

    console.log(`[API] [Performance] ✅ Audio fetch completed in ${totalTime}ms (query: ${queryEndTime - queryStartTime}ms, decode: ${decodeEndTime - decodeStartTime}ms, serialize: ${serializeEndTime - serializeStartTime}ms, size: ${(audioSize / 1024).toFixed(0)}KB)`);
    return response;
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

    // Remove any whitespace, newlines, and other non-base64 characters
    let cleanedAudioData = audioData.replace(/[\s\n\r\t]/g, '');
    
    // Remove any non-base64 characters (keep only A-Z, a-z, 0-9, +, /, =)
    // This is more lenient - removes invalid chars instead of rejecting
    cleanedAudioData = cleanedAudioData.replace(/[^A-Za-z0-9+/=]/g, '');

    // Validate base64 format - check for valid base64 characters
    // Base64 can have padding (=) only at the end, and should be valid base64 chars
    const base64Regex = /^[A-Za-z0-9+/]+=*$/;
    if (!base64Regex.test(cleanedAudioData)) {
      // Find the first invalid character for debugging
      const invalidCharIndex = cleanedAudioData.search(/[^A-Za-z0-9+/=]/);
      const contextStart = Math.max(0, invalidCharIndex - 20);
      const contextEnd = Math.min(cleanedAudioData.length, invalidCharIndex + 20);
      
      console.error('[API] Invalid base64 format in audio data', {
        length: cleanedAudioData.length,
        originalLength: audioData.length,
        firstChars: cleanedAudioData.substring(0, 50),
        lastChars: cleanedAudioData.substring(Math.max(0, cleanedAudioData.length - 50)),
        invalidCharIndex: invalidCharIndex !== -1 ? invalidCharIndex : 'not found',
        context: invalidCharIndex !== -1 ? cleanedAudioData.substring(contextStart, contextEnd) : 'N/A',
        hasWhitespace: /\s/.test(audioData),
        hasNewlines: /\n/.test(audioData),
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

    // Save audio data to database
    await prisma.journalEntry.update({
      where: { id: entryId },
      data: { audioData: cleanedAudioData },
    });

    const audioSize = (cleanedAudioData.length / 1024).toFixed(1);
    console.log(`[API] ✅ Saved audio for entry ${entryId} (user: ${userId}, size: ${audioSize}KB)`);
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

