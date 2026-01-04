import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/app/auth';
import { isS3Configured } from '@/app/utils/s3Service';
import { S3Client, HeadBucketCommand } from '@aws-sdk/client-s3';

const BUCKET_NAME = process.env.AWS_S3_BUCKET_NAME;
const REGION = process.env.AWS_REGION || 'us-east-1';

/**
 * GET /api/s3/test
 * Test S3 connection and configuration
 */
export async function GET(request: NextRequest) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const testStartTime = Date.now();

  try {
    // Check if S3 is configured
    if (!isS3Configured()) {
      return NextResponse.json({
        configured: false,
        error: 'S3 not configured',
        message: 'Missing required environment variables',
        missing: [
          !process.env.AWS_S3_BUCKET_NAME && 'AWS_S3_BUCKET_NAME',
          !process.env.AWS_ACCESS_KEY_ID && 'AWS_ACCESS_KEY_ID',
          !process.env.AWS_SECRET_ACCESS_KEY && 'AWS_SECRET_ACCESS_KEY',
        ].filter(Boolean),
      });
    }

    // Test S3 connection
    const s3Client = new S3Client({
      region: REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    });

    console.log(`[S3 Test] Testing S3 connection to bucket: ${BUCKET_NAME} in region: ${REGION}`);

    try {
      const command = new HeadBucketCommand({ Bucket: BUCKET_NAME! });
      const connectionStartTime = Date.now();
      await s3Client.send(command);
      const connectionTime = Date.now() - connectionStartTime;
      const totalTime = Date.now() - testStartTime;

      console.log(`[S3 Test] ✅ S3 connection successful in ${connectionTime}ms (total: ${totalTime}ms)`);

      return NextResponse.json({
        configured: true,
        connected: true,
        bucket: BUCKET_NAME,
        region: REGION,
        connectionTime,
        totalTime,
        message: 'S3 connection successful',
      });
    } catch (s3Error: any) {
      const connectionTime = Date.now() - testStartTime;
      console.error(`[S3 Test] ❌ S3 connection failed after ${connectionTime}ms:`, s3Error);

      return NextResponse.json({
        configured: true,
        connected: false,
        bucket: BUCKET_NAME,
        region: REGION,
        error: s3Error.name || 'ConnectionError',
        message: s3Error.message || 'Failed to connect to S3',
        connectionTime,
      }, { status: 500 });
    }
  } catch (error: any) {
    const totalTime = Date.now() - testStartTime;
    console.error(`[S3 Test] ❌ Test failed after ${totalTime}ms:`, error);

    return NextResponse.json({
      configured: false,
      connected: false,
      error: error.name || 'UnknownError',
      message: error.message || 'Unknown error',
      totalTime,
    }, { status: 500 });
  }
}

