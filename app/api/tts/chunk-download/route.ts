import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/app/auth';
import { downloadAudio, isS3Configured } from '@/app/utils/s3Service';

/**
 * POST /api/tts/chunk-download
 * Download a chunk from S3 cache
 */
export async function POST(request: NextRequest) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let s3Key: string = '';

  try {
    const body = await request.json();
    s3Key = body.s3Key;

    if (!s3Key || typeof s3Key !== 'string') {
      return NextResponse.json({ error: 's3Key is required' }, { status: 400 });
    }

    if (!isS3Configured()) {
      return NextResponse.json({ error: 'S3 not configured' }, { status: 500 });
    }

    console.log(`[Chunk Download] Downloading chunk from S3: ${s3Key}`);

    const downloadStartTime = Date.now();
    const audioBuffer = await downloadAudio(s3Key);
    const downloadTime = Date.now() - downloadStartTime;

    console.log(`[Chunk Download] ✅ Downloaded chunk: ${s3Key} (${(audioBuffer.length / 1024).toFixed(1)}KB) in ${downloadTime}ms`);

    // Convert buffer to base64 for JSON response
    const base64 = Buffer.from(audioBuffer).toString('base64');

    return NextResponse.json({
      success: true,
      s3Key,
      audioData: base64,
      audioSize: audioBuffer.length,
      downloadTime,
    });
  } catch (error: any) {
    console.error('[Chunk Download] Error:', error);
    
    // Check if it's a 404 (chunk doesn't exist)
    if (error?.$metadata?.httpStatusCode === 404 || error?.message?.includes('404')) {
      return NextResponse.json(
        {
          error: 'Chunk not found',
          message: `Chunk ${s3Key} does not exist in S3`,
        },
        { status: 404 }
      );
    }

    return NextResponse.json(
      {
        error: 'Failed to download chunk',
        message: error?.message || 'Unknown error',
      },
      { status: 500 }
    );
  }
}

