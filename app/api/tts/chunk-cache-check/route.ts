import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/app/auth';
import { checkObjectExists } from '@/app/utils/s3Service';

/**
 * POST /api/tts/chunk-cache-check
 * Check cache status for multiple chunks
 */
export async function POST(request: NextRequest) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { s3Keys } = body;

    if (!Array.isArray(s3Keys)) {
      return NextResponse.json({ error: 's3Keys must be an array' }, { status: 400 });
    }

    // Check each chunk's cache status
    const cacheStatus: Record<string, boolean> = {};
    const checkPromises = s3Keys.map(async (key: string) => {
      const exists = await checkObjectExists(key);
      cacheStatus[key] = exists;
      return { key, exists };
    });

    await Promise.all(checkPromises);

    return NextResponse.json({
      cacheStatus,
      total: s3Keys.length,
      hits: Object.values(cacheStatus).filter(Boolean).length,
      misses: Object.values(cacheStatus).filter(v => !v).length,
    });
  } catch (error: any) {
    console.error('[API] Failed to check chunk cache:', error);
    return NextResponse.json(
      {
        error: 'Failed to check chunk cache',
        message: error?.message || 'Unknown error',
      },
      { status: 500 }
    );
  }
}

