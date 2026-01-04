// S3 service utility for audio storage
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const BUCKET_NAME = process.env.AWS_S3_BUCKET_NAME;
const REGION = process.env.AWS_REGION || 'us-east-1';

if (!BUCKET_NAME) {
  console.warn('[S3Service] AWS_S3_BUCKET_NAME not configured. S3 functionality will be disabled.');
}

// Initialize S3 client
const s3Client = new S3Client({
  region: REGION,
  credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
    ? {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      }
    : undefined,
});

/**
 * Upload audio buffer to S3
 * @param buffer - Audio buffer as Uint8Array
 * @param key - S3 object key (e.g., "audio/userId/hash.wav")
 * @returns S3 object key
 */
export async function uploadAudio(buffer: Uint8Array, key: string): Promise<string> {
  if (!BUCKET_NAME) {
    throw new Error('S3 bucket not configured');
  }

  const uploadStartTime = Date.now();
  const bufferSizeKB = (buffer.length / 1024).toFixed(1);
  console.log(`[S3Service] [Upload] Starting upload: ${key} (${bufferSizeKB}KB)`);

  try {
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: 'audio/wav',
      CacheControl: 'public, max-age=31536000', // Cache for 1 year
    });

    const sendStartTime = Date.now();
    await s3Client.send(command);
    const sendTime = Date.now() - sendStartTime;
    const totalTime = Date.now() - uploadStartTime;
    
    console.log(`[S3Service] [Upload] ✅ Upload completed: ${key} (${bufferSizeKB}KB) in ${totalTime}ms (S3 send: ${sendTime}ms)`);
    return key;
  } catch (error) {
    const totalTime = Date.now() - uploadStartTime;
    console.error(`[S3Service] [Upload] ❌ Upload failed: ${key} after ${totalTime}ms`, error);
    throw error;
  }
}

/**
 * Generate pre-signed URL for S3 object
 * @param key - S3 object key
 * @param expiresIn - Expiration time in seconds (default: 600 = 10 minutes)
 * @returns Pre-signed URL
 */
export async function generatePresignedUrl(key: string, expiresIn: number = 600): Promise<string> {
  if (!BUCKET_NAME) {
    throw new Error('S3 bucket not configured');
  }

  const urlStartTime = Date.now();
  console.log(`[S3Service] [PresignedURL] Generating pre-signed URL for ${key} (expires in ${expiresIn}s)...`);

  try {
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });

    const url = await getSignedUrl(s3Client, command, { expiresIn });
    const urlTime = Date.now() - urlStartTime;
    console.log(`[S3Service] [PresignedURL] ✅ Generated pre-signed URL for ${key} in ${urlTime}ms (expires in ${expiresIn}s)`);
    return url;
  } catch (error) {
    const urlTime = Date.now() - urlStartTime;
    console.error(`[S3Service] [PresignedURL] ❌ Failed to generate pre-signed URL for ${key} after ${urlTime}ms:`, error);
    throw error;
  }
}

/**
 * Delete audio from S3
 * @param key - S3 object key
 */
export async function deleteAudio(key: string): Promise<void> {
  if (!BUCKET_NAME) {
    throw new Error('S3 bucket not configured');
  }

  try {
    const command = new DeleteObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });

    await s3Client.send(command);
    console.log(`[S3Service] ✅ Deleted audio from S3: ${key}`);
  } catch (error) {
    console.error(`[S3Service] ❌ Failed to delete audio from S3: ${key}`, error);
    throw error;
  }
}

/**
 * Check if S3 is configured
 */
export function isS3Configured(): boolean {
  return !!BUCKET_NAME && !!process.env.AWS_ACCESS_KEY_ID && !!process.env.AWS_SECRET_ACCESS_KEY;
}

