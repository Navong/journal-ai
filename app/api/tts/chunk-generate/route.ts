import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/app/auth';
import { getTTSProvider } from '@/app/services/providers/tts';
import { uploadAudio, isS3Configured } from '@/app/utils/s3Service';
import { generateChunkHashSync, generateChunkS3Key, normalizeChunk } from '@/app/utils/chunkCaching';

/**
 * POST /api/tts/chunk-generate
 * Generate TTS for a single chunk and upload to S3 cache
 */
export async function POST(request: NextRequest) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { chunkText } = body;

    if (!chunkText || typeof chunkText !== 'string') {
      return NextResponse.json({ error: 'chunkText is required' }, { status: 400 });
    }

    // Normalize the chunk
    const normalized = normalizeChunk(chunkText);
    
    // Generate hash and S3 key
    const hash = generateChunkHashSync(normalized);
    const s3Key = generateChunkS3Key(hash);

    console.log(`[Chunk Generate] Processing chunk: "${normalized.substring(0, 50)}..."`);
    console.log(`[Chunk Generate] Hash: ${hash}`);
    console.log(`[Chunk Generate] S3 Key: ${s3Key}`);

    // Generate TTS for the chunk
    const ttsProvider = getTTSProvider();
    const audioStream = await ttsProvider.generateSpeechStream(normalized);

    if (!audioStream) {
      return NextResponse.json(
        { error: 'Failed to generate speech', message: 'No audio stream returned.' },
        { status: 500 }
      );
    }

    // Buffer the audio stream
    const chunks: Uint8Array[] = [];
    const reader = audioStream.getReader();
    let totalLength = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        totalLength += value.length;
      }
    }

    // Combine chunks into single buffer
    const audioBuffer = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      audioBuffer.set(chunk, offset);
      offset += chunk.length;
    }

    console.log(`[Chunk Generate] Generated audio: ${(audioBuffer.length / 1024).toFixed(1)}KB`);

    // Upload to S3 if configured
    if (isS3Configured()) {
      console.log(`[Chunk Generate] Uploading to S3: ${s3Key}...`);
      const uploadStartTime = Date.now();
      await uploadAudio(audioBuffer, s3Key);
      const uploadTime = Date.now() - uploadStartTime;
      console.log(`[Chunk Generate] ✅ Uploaded to S3 in ${uploadTime}ms: ${s3Key}`);
    } else {
      console.log(`[Chunk Generate] ⚠️ S3 not configured - skipping upload`);
    }

    // Convert buffer to base64 for JSON response
    const base64 = Buffer.from(audioBuffer).toString('base64');

    // Return the audio buffer and metadata
    return NextResponse.json({
      success: true,
      s3Key,
      hash,
      normalized,
      audioSize: audioBuffer.length,
      audioData: base64, // Include audio data so we don't need to download again
      uploaded: isS3Configured(),
    });
  } catch (error: any) {
    console.error('[Chunk Generate] Error:', error);
    return NextResponse.json(
      {
        error: 'Failed to generate chunk',
        message: error?.message || 'Unknown error',
      },
      { status: 500 }
    );
  }
}

