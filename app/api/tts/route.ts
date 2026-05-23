import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/app/auth';
import logger from '@/app/utils/logger';
import { connectMongo } from '@/app/utils/mongodb';
import { JournalEntry } from '@/app/models/JournalEntry';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PollyClient, SynthesizeSpeechCommand } from '@aws-sdk/client-polly';

const log = logger.module('api/tts');

export const runtime = 'nodejs';

type TtsRequestBody = {
  entryId: string;
  text: string;
};

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}


function getBucketName(): string {
  return (
    process.env.S3_BUCKET ||
    process.env.AWS_S3_BUCKET_NAME ||
    requireEnv('S3_BUCKET')
  );
}

function getRegion(): string {
  return (
    process.env.AWS_REGION ||
    process.env.S3_REGION ||
    requireEnv('AWS_REGION')
  );
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = session.user.id;

  const mongo = await connectMongo();
  if (!mongo) return NextResponse.json({ error: 'Database not configured' }, { status: 500 });

  let body: TtsRequestBody;
  try {
    body = (await req.json()) as TtsRequestBody;
  } catch (error) {
    log.warn('Invalid JSON body', {}, error as Error);
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const entryId = (body.entryId || '').trim();
  const text = (body.text || '').trim();
  if (!entryId || !text) {
    return NextResponse.json({ error: 'entryId and text are required' }, { status: 400 });
  }

  // Keep minimal/safe bounds (prevents huge requests or runaway costs)
  if (text.length > 5000) {
    return NextResponse.json({ error: 'Text too long (max 5000 chars)' }, { status: 400 });
  }

  try {
    const region = getRegion();
    const bucket = getBucketName();
    const voiceId = (process.env.TTS_VOICE_ID || 'Joanna') as any;

    const polly = new PollyClient({ region });
    const s3 = new S3Client({ region, followRegionRedirects: true });

    const synth = await polly.send(
      new SynthesizeSpeechCommand({
        OutputFormat: 'mp3',
        Text: text,
        VoiceId: voiceId,
        Engine: 'neural',
        TextType: 'text',
      })
    );

    const audioStream = synth.AudioStream;
    if (!audioStream) {
      throw new Error('No audio returned from TTS provider');
    }

    const audioBytes = Buffer.from(await audioStream.transformToByteArray());

    const key = `journal-audio/${encodeURIComponent(userId)}/${encodeURIComponent(entryId)}.mp3`;

    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: audioBytes,
        ContentType: 'audio/mpeg',
        CacheControl: 'public, max-age=31536000, immutable',
      })
    );

    // Presigned URL valid for 7 days — browser can fetch private S3 object
    const playbackUrl = await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: bucket, Key: key }),
      { expiresIn: 604800 }
    );

    // Persist the stable S3 key path (not the presigned URL) so we can re-sign later
    const s3Key = key;
    const updated = await JournalEntry.findOneAndUpdate(
      { _id: entryId, userId },
      { $set: { reflectionAudioUrl: s3Key } },
      { new: true }
    ).lean();

    if (!updated) {
      log.warn('Entry not found to persist audio key', { entryId, userId });
    }

    return NextResponse.json({ audioUrl: playbackUrl });
  } catch (error: any) {
    log.error('TTS generation failed', { userId, entryId }, error as Error);
    return NextResponse.json(
      { error: 'TTS generation failed', message: error?.message || 'Unknown error' },
      { status: 500 }
    );
  }
}

