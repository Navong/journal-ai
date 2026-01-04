import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/app/auth';
import { hashTTSInput } from '@/app/utils/textHash';

/**
 * POST /api/s3/get-key
 * Calculate expected S3 key for given text (for testing/debugging)
 */
export async function POST(request: NextRequest) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { text, voiceId } = body;

    if (!text || typeof text !== 'string') {
      return NextResponse.json({ error: 'Text is required' }, { status: 400 });
    }

    const userId = session.user.id;
    const actualVoiceId = voiceId || process.env.CARTESIA_VOICE_ID || '694f9389-aac1-45b6-b726-9d9369183238';
    const textHash = hashTTSInput(text, actualVoiceId);
    const s3Key = `audio/${userId}/${textHash}.wav`;

    return NextResponse.json({
      s3Key,
      textHash,
      voiceId: actualVoiceId,
      userId,
    });
  } catch (error: any) {
    console.error('[API] Failed to calculate S3 key:', error);
    return NextResponse.json(
      {
        error: 'Failed to calculate S3 key',
        message: error?.message || 'Unknown error',
      },
      { status: 500 }
    );
  }
}

