import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/utils/prisma';

/**
 * POST /api/history/audio/s3key
 * Save S3 key for a specific journal entry
 */
export async function POST(request: NextRequest) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!prisma) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
  }

  const userId = session.user.id;

  try {
    const body = await request.json();
    const { entryId, s3Key } = body;

    if (!entryId) {
      return NextResponse.json({ error: 'Entry ID required' }, { status: 400 });
    }

    if (!s3Key || typeof s3Key !== 'string') {
      return NextResponse.json({ error: 'S3 key required' }, { status: 400 });
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

    // Update audio S3 key
    await prisma.journalEntry.update({
      where: { id: entryId },
      data: { audioS3Key: s3Key },
    });

    console.log(`[API] ✅ Saved S3 key for entry ${entryId} (user: ${userId})`);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[API] Failed to save S3 key:', error);
    return NextResponse.json(
      {
        error: 'Failed to save S3 key',
        message: error?.message || 'Unknown error',
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/history/audio/s3key?entryId=xxx
 * Get S3 key for a specific journal entry
 */
export async function GET(request: NextRequest) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!prisma) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 500 });
  }

  const userId = session.user.id;

  try {
    const { searchParams } = new URL(request.url);
    const entryId = searchParams.get('entryId');

    if (!entryId) {
      return NextResponse.json({ error: 'Entry ID required' }, { status: 400 });
    }

    // Get entry with S3 key
    const entry = await prisma.journalEntry.findUnique({
      where: { id: entryId },
      select: { userId: true, audioS3Key: true },
    });

    if (!entry) {
      return NextResponse.json({ error: 'Entry not found' }, { status: 404 });
    }

    if (entry.userId !== userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    if (!entry.audioS3Key) {
      return NextResponse.json({ error: 'S3 key not found' }, { status: 404 });
    }

    return NextResponse.json({ s3Key: entry.audioS3Key });
  } catch (error: any) {
    console.error('[API] Failed to get S3 key:', error);
    return NextResponse.json(
      {
        error: 'Failed to get S3 key',
        message: error?.message || 'Unknown error',
      },
      { status: 500 }
    );
  }
}

