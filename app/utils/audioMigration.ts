// Audio migration utility
// Migrates audio from IndexedDB to database (manual migration page)
// Note: This is now redundant since automatic background sync is implemented,
// but kept for backward compatibility with the migrate-audio page

import { audioCache } from './audioCache';
import { historyService } from '../lib/core/history';
import { hashText } from './textHash';

export interface MigrationProgress {
  total: number;
  processed: number;
  matched: number;
  optimized: number;
  saved: number;
  errors: number;
  currentEntry?: string;
}

interface MigrationResult {
  success: boolean;
  total: number;
  matched: number;
  saved: number;
  errors: number;
  errorDetails: string[];
}

/**
 * Migrate audio from IndexedDB to database
 * Matches audio by reflection text hash
 */
export async function migrateAudioToDatabase(
  onProgress?: (progress: MigrationProgress) => void
): Promise<MigrationResult> {
  const result: MigrationResult = {
    success: true,
    total: 0,
    matched: 0,
    saved: 0,
    errors: 0,
    errorDetails: [],
  };

  try {
    // Get all cached audio entries
    console.log('[audioMigration] Fetching all audio entries from IndexedDB...');
    const audioEntries = await audioCache.getAllEntries();
    result.total = audioEntries.length;

    if (audioEntries.length === 0) {
      console.log('[audioMigration] No audio entries found in IndexedDB');
      return result;
    }

    console.log(`[audioMigration] Found ${audioEntries.length} audio entries`);

    // Get all journal entries from database
    console.log('[audioMigration] Fetching journal entries from database...');
    const historyResult = await historyService.fetchHistory();
    // Handle both old format (array) and new format (object with entries)
    const journalEntries = Array.isArray(historyResult) ? historyResult : historyResult.entries || [];

    if (journalEntries.length === 0) {
      console.log('[audioMigration] No journal entries found in database');
      return result;
    }

    console.log(`[audioMigration] Found ${journalEntries.length} journal entries`);

    // Create a map of reflection text hash -> journal entry
    const reflectionHashMap = new Map<string, typeof journalEntries[0]>();
    for (const entry of journalEntries) {
      const reflectionHash = hashText(entry.reflection);
      reflectionHashMap.set(reflectionHash, entry);
    }

    console.log(`[audioMigration] Created hash map for ${reflectionHashMap.size} reflections`);

    // Process each audio entry
    for (let i = 0; i < audioEntries.length; i++) {
      const audioEntry = audioEntries[i];
      const processed = i + 1;

      if (onProgress) {
        onProgress({
          total: audioEntries.length,
          processed: processed,
          matched: result.matched,
          optimized: result.saved,
          saved: result.saved,
          errors: result.errors,
          currentEntry: `Processing audio ${processed}/${audioEntries.length}`,
        });
      }

      // Find matching journal entry by reflection text hash
      const matchingEntry = reflectionHashMap.get(audioEntry.textHash);

      if (!matchingEntry) {
        console.warn(`[audioMigration] No matching entry found for hash ${audioEntry.textHash}`);
        continue;
      }

      // Skip if entry already has audio
      if (matchingEntry.audioBase64) {
        console.log(`[audioMigration] Entry ${matchingEntry.id} already has audio, skipping`);
        continue;
      }

      result.matched++;

      try {
        // Save to database
        console.log(`[audioMigration] Saving audio for entry ${matchingEntry.id}...`);
        await historyService.saveEntryAudio(matchingEntry.id, audioEntry.audioBase64);

        result.saved++;
        console.log(`[audioMigration] ✅ Successfully migrated audio for entry ${matchingEntry.id}`);
      } catch (error: any) {
        result.errors++;
        const errorMsg = `Entry ${matchingEntry.id}: ${error?.message || 'Unknown error'}`;
        result.errorDetails.push(errorMsg);
        console.error(`[audioMigration] ❌ Error migrating audio for entry ${matchingEntry.id}:`, error);

        // Try saving original audio as fallback
        try {
          console.log(`[audioMigration] Attempting to save original audio as fallback...`);
          await historyService.saveEntryAudio(matchingEntry.id, audioEntry.audioBase64);
          result.saved++;
          console.log(`[audioMigration] ✅ Saved original audio for entry ${matchingEntry.id}`);
        } catch (fallbackError) {
          console.error(`[audioMigration] ❌ Fallback save also failed:`, fallbackError);
        }
      }

      // Small delay to avoid overwhelming the browser
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    console.log(`[audioMigration] ✅ Migration complete: ${result.saved}/${result.total} audio files migrated`);
    return result;
  } catch (error: any) {
    console.error('[audioMigration] Migration failed:', error);
    result.success = false;
    result.errorDetails.push(`Migration failed: ${error?.message || 'Unknown error'}`);
    return result;
  }
}

/**
 * Get migration statistics
 */
export async function getMigrationStats(): Promise<{
  cachedAudioCount: number;
  journalEntriesCount: number;
  entriesWithAudio: number;
  entriesNeedingMigration: number;
}> {
  const audioEntries = await audioCache.getAllEntries();
  const historyResult = await historyService.fetchHistory();
  // Handle both old format (array) and new format (object with entries)
  const journalEntries = Array.isArray(historyResult) ? historyResult : historyResult.entries || [];

  const reflectionHashMap = new Map<string, string>();
  for (const entry of journalEntries) {
    const reflectionHash = hashText(entry.reflection);
    reflectionHashMap.set(reflectionHash, entry.id);
  }

  let entriesWithAudio = 0;
  let entriesNeedingMigration = 0;

  for (const audioEntry of audioEntries) {
    const entryId = reflectionHashMap.get(audioEntry.textHash);
    if (entryId) {
      const entry = journalEntries.find(e => e.id === entryId);
      if (entry?.audioBase64) {
        entriesWithAudio++;
      } else {
        entriesNeedingMigration++;
      }
    }
  }

  return {
    cachedAudioCount: audioEntries.length,
    journalEntriesCount: journalEntries.length,
    entriesWithAudio,
    entriesNeedingMigration,
  };
}

