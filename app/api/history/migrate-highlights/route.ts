import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/utils/prisma';
import { extractHighlightsFromReflection } from '@/utils/highlightMigration';
import logger from '@/utils/logger';
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

    // Count entries already processed (have migrated_at marker in highlights JSON)
    // We use a simple approach: count entries where highlights is not null
    // The migration will track processed entries separately
    const entriesWithHighlights = await prisma.journalEntry.count({
      where: {
        userId,
        NOT: { highlights: { equals: Prisma.DbNull } },
      },
    });

    const entriesWithoutHighlights = totalEntries - entriesWithHighlights;

    log.info('Migration stats fetched', {
      userId,
      total: totalEntries,
      withHighlights: entriesWithHighlights,
      withoutHighlights: entriesWithoutHighlights,
    });

    return NextResponse.json({
      total: totalEntries,
      withHighlights: entriesWithHighlights,
      withoutHighlights: entriesWithoutHighlights,
      // All entries can be re-migrated to get main_idea highlights
      canMigrate: totalEntries,
    });
  } catch (error: any) {
    log.error('Failed to get migration stats', { userId }, error);
    return NextResponse.json({ error: 'Failed to get migration stats' }, { status: 500 });
  }
}

// POST: Run highlight migration for ALL entries (re-extract highlights with main_idea)
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
    const offset = body.offset || 0; // Track progress across batches

    log.info('Starting highlight migration', { userId, batchSize, delayMs, offset });

    // Get ALL entries (sorted by createdAt desc, with offset for pagination)
    const entriesToProcess = await prisma.journalEntry.findMany({
      where: { userId },
      select: {
        id: true,
        reflectionText: true,
        createdAt: true,
      },
      orderBy: {
        createdAt: 'desc', // Process newest first
      },
      skip: offset,
      take: batchSize,
    });

    if (entriesToProcess.length === 0) {
      log.info('No more entries to migrate', { userId, offset });
      return NextResponse.json({
        success: true,
        message: 'Migration complete - no more entries',
        processed: 0,
        updated: 0,
        skipped: 0,
        errors: 0,
        remaining: 0,
        nextOffset: offset,
        done: true,
      });
    }

    log.info(`Processing ${entriesToProcess.length} entries for highlight migration`, { userId, offset });

    let updated = 0;
    let skipped = 0;
    let errors = 0;
    const errorDetails: string[] = [];

    for (let i = 0; i < entriesToProcess.length; i++) {
      const entry = entriesToProcess[i];

      try {
        // Extract highlights from reflection text (now includes main_idea)
        const highlights = await extractHighlightsFromReflection(entry.reflectionText);

        if (highlights.length > 0) {
          // Update entry with new highlights (cast to Prisma InputJsonValue)
          await prisma.journalEntry.update({
            where: { id: entry.id },
            data: { highlights: highlights as unknown as Prisma.InputJsonValue },
          });
          updated++;
          log.debug(`Updated entry ${entry.id} with ${highlights.length} highlights`);
        } else {
          // Mark as processed with empty array
          await prisma.journalEntry.update({
            where: { id: entry.id },
            data: { highlights: [] as unknown as Prisma.InputJsonValue },
          });
          skipped++;
          log.debug(`Entry ${entry.id} has no highlights to extract`);
        }

        // Rate limiting delay (skip on last iteration)
        if (i < entriesToProcess.length - 1 && delayMs > 0) {
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      } catch (error: any) {
        errors++;
        const errorMsg = `Entry ${entry.id}: ${error?.message || 'Unknown error'}`;
        errorDetails.push(errorMsg);
        log.error(`Failed to migrate highlights for entry ${entry.id}`, {}, error);
      }
    }

    // Calculate next offset and remaining
    const nextOffset = offset + entriesToProcess.length;
    const totalEntries = await prisma.journalEntry.count({ where: { userId } });
    const remaining = Math.max(0, totalEntries - nextOffset);

    log.info('Highlight migration batch complete', {
      userId,
      processed: entriesToProcess.length,
      updated,
      skipped,
      errors,
      remaining,
      nextOffset,
    });

    return NextResponse.json({
      success: errors === 0,
      message: `Processed ${entriesToProcess.length} entries`,
      processed: entriesToProcess.length,
      updated,
      skipped,
      errors,
      remaining,
      nextOffset,
      done: remaining === 0,
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
