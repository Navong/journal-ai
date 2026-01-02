import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/app/auth';
import { prisma } from '@/app/utils/prisma';
import { extractHighlightsFromReflection } from '@/app/utils/highlightMigration';
import logger from '@/app/utils/logger';
import { Prisma } from '@prisma/client';

const log = logger.module('MigrateHighlights');

// GET: Get stats about entries needing highlight migration
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
    // Count total entries
    const totalEntries = await prisma.journalEntry.count({
      where: { userId },
    });

    // Count entries without highlights (null in database)
    const entriesWithoutHighlights = await prisma.journalEntry.count({
      where: {
        userId,
        highlights: { equals: Prisma.DbNull },
      },
    });

    // Count entries with highlights
    const entriesWithHighlights = totalEntries - entriesWithoutHighlights;

    log.info('Migration stats fetched', {
      userId,
      total: totalEntries,
      withHighlights: entriesWithHighlights,
      needsMigration: entriesWithoutHighlights,
    });

    return NextResponse.json({
      total: totalEntries,
      withHighlights: entriesWithHighlights,
      needsMigration: entriesWithoutHighlights,
    });
  } catch (error: any) {
    log.error('Failed to get migration stats', { userId }, error);
    return NextResponse.json({ error: 'Failed to get migration stats' }, { status: 500 });
  }
}

// POST: Run highlight migration for entries without highlights
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
    const body = await request.json().catch(() => ({}));
    const batchSize = Math.min(body.batchSize || 5, 10); // Max 10 per batch to avoid timeouts
    const delayMs = body.delayMs || 1000; // Delay between API calls (rate limiting)

    log.info('Starting highlight migration', { userId, batchSize, delayMs });

    // Get entries without highlights (null in database)
    const entriesWithoutHighlights = await prisma.journalEntry.findMany({
      where: {
        userId,
        highlights: { equals: Prisma.DbNull },
      },
      select: {
        id: true,
        reflectionText: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: 'desc', // Process newest first
      },
      take: batchSize,
    });

    if (entriesWithoutHighlights.length === 0) {
      log.info('No entries need highlight migration', { userId });
      return NextResponse.json({
        success: true,
        message: 'No entries need migration',
        processed: 0,
        updated: 0,
        skipped: 0,
        errors: 0,
        remaining: 0,
      });
    }

    log.info(`Processing ${entriesWithoutHighlights.length} entries for highlight migration`, { userId });

    let updated = 0;
    let skipped = 0;
    let errors = 0;
    const errorDetails: string[] = [];

    for (let i = 0; i < entriesWithoutHighlights.length; i++) {
      const entry = entriesWithoutHighlights[i];

      try {
        // Extract highlights from reflection text
        const highlights = await extractHighlightsFromReflection(entry.reflectionText);

        if (highlights.length > 0) {
          // Update entry with highlights (cast to Prisma InputJsonValue)
          await prisma.journalEntry.update({
            where: { id: entry.id },
            data: { highlights: highlights as unknown as Prisma.InputJsonValue },
          });
          updated++;
          log.debug(`Updated entry ${entry.id} with ${highlights.length} highlights`);
        } else {
          // Mark as processed with empty array (so we don't re-process)
          await prisma.journalEntry.update({
            where: { id: entry.id },
            data: { highlights: [] as unknown as Prisma.InputJsonValue },
          });
          skipped++;
          log.debug(`Entry ${entry.id} has no highlights to extract`);
        }

        // Rate limiting delay (skip on last iteration)
        if (i < entriesWithoutHighlights.length - 1 && delayMs > 0) {
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      } catch (error: any) {
        errors++;
        const errorMsg = `Entry ${entry.id}: ${error?.message || 'Unknown error'}`;
        errorDetails.push(errorMsg);
        log.error(`Failed to migrate highlights for entry ${entry.id}`, {}, error);
      }
    }

    // Get remaining count (entries with null highlights)
    const remaining = await prisma.journalEntry.count({
      where: {
        userId,
        highlights: { equals: Prisma.DbNull },
      },
    });

    log.info('Highlight migration batch complete', {
      userId,
      processed: entriesWithoutHighlights.length,
      updated,
      skipped,
      errors,
      remaining,
    });

    return NextResponse.json({
      success: errors === 0,
      message: `Processed ${entriesWithoutHighlights.length} entries`,
      processed: entriesWithoutHighlights.length,
      updated,
      skipped,
      errors,
      remaining,
      errorDetails: errorDetails.length > 0 ? errorDetails : undefined,
    });
  } catch (error: any) {
    log.error('Highlight migration failed', { userId }, error);
    return NextResponse.json({
      error: 'Migration failed',
      message: error?.message || 'Unknown error',
    }, { status: 500 });
  }
}
