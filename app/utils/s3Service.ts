// S3 service utility for audio storage
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
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
 * Check if an object exists in S3 (using HeadObject - cheap and fast)
 * @param key - S3 object key
 * @returns True if object exists, false otherwise
 */
export async function checkObjectExists(key: string): Promise<boolean> {
  if (!BUCKET_NAME) {
    return false;
  }

  try {
    const command = new HeadObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });

    await s3Client.send(command);
    return true;
  } catch (error: any) {
    // 404 means object doesn't exist, which is fine
    if (error?.$metadata?.httpStatusCode === 404) {
      return false;
    }
    // Other errors (permissions, network, etc.) - log and return false
    console.warn(`[S3Service] [HeadObject] Error checking ${key}:`, error?.message || error);
    return false;
  }
}

/**
 * Download audio buffer from S3
 * @param key - S3 object key
 * @returns Audio buffer as Uint8Array
 */
export async function downloadAudio(key: string): Promise<Uint8Array> {
  if (!BUCKET_NAME) {
    throw new Error('S3 bucket not configured');
  }

  const downloadStartTime = Date.now();
  console.log(`[S3Service] [Download] Starting download: ${key}...`);

  try {
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });

    const response = await s3Client.send(command);
    
    if (!response.Body) {
      throw new Error('No body in S3 response');
    }

    // Convert stream to buffer
    const chunks: Uint8Array[] = [];
    const stream = response.Body as any;
    
    // Handle different stream types
    if (stream.transformToWebStream) {
      const reader = stream.transformToWebStream().getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
        }
      }
    } else if (stream[Symbol.asyncIterator]) {
      for await (const chunk of stream) {
        chunks.push(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk));
      }
    } else {
      // Fallback: read as array buffer
      const arrayBuffer = await stream.arrayBuffer();
      chunks.push(new Uint8Array(arrayBuffer));
    }

    // Combine chunks
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const buffer = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      buffer.set(chunk, offset);
      offset += chunk.length;
    }

    const downloadTime = Date.now() - downloadStartTime;
    const bufferSizeKB = (buffer.length / 1024).toFixed(1);
    console.log(`[S3Service] [Download] ✅ Download completed: ${key} (${bufferSizeKB}KB) in ${downloadTime}ms`);
    
    return buffer;
  } catch (error) {
    const downloadTime = Date.now() - downloadStartTime;
    console.error(`[S3Service] [Download] ❌ Download failed: ${key} after ${downloadTime}ms`, error);
    throw error;
  }
}

/**
 * Check if S3 is configured
 */
export function isS3Configured(): boolean {
  return !!BUCKET_NAME && !!process.env.AWS_ACCESS_KEY_ID && !!process.env.AWS_SECRET_ACCESS_KEY;
}

