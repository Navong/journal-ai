// Automatic background audio sync utility
// Syncs audio from IndexedDB to Supabase in the background

import { audioCache } from './audioCache';
import { historyService } from '../lib/core/history';
import { hashText } from './textHash';

export interface AudioSyncProgress {
  total: number;
  processed: number;
  matched: number;
  saved: number;
  errors: number;
  isComplete: boolean;
}

export interface AudioSyncState {
  isRunning: boolean;
  lastSyncTime: number | null;
  progress: AudioSyncProgress | null;
  error: string | null;
}

const SYNC_STORAGE_KEY = 'serenity_audio_sync_state';
export const SYNC_INTERVAL = 5 * 60 * 1000; // 5 minutes between syncs
const MAX_SYNC_ATTEMPTS = 3;

/**
 * Get sync state from localStorage
 */
export function getSyncState(): AudioSyncState {
  if (typeof window === 'undefined') {
    return {
      isRunning: false,
      lastSyncTime: null,
      progress: null,
      error: null,
    };
  }

  try {
    const stored = localStorage.getItem(SYNC_STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (error) {
    console.error('[audioSync] Failed to load sync state:', error);
  }

  return {
    isRunning: false,
    lastSyncTime: null,
    progress: null,
    error: null,
  };
}

/**
 * Save sync state to localStorage
 */
function saveSyncState(state: AudioSyncState): void {
  if (typeof window === 'undefined') return;

  try {
    localStorage.setItem(SYNC_STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.error('[audioSync] Failed to save sync state:', error);
  }
}

/**
 * Check if sync should run (based on last sync time)
 */
export function shouldRunSync(): boolean {
  const state = getSyncState();

  // If never synced, should run
  if (!state.lastSyncTime) {
    return true;
  }

  // If last sync was more than SYNC_INTERVAL ago, should run
  const timeSinceLastSync = Date.now() - state.lastSyncTime;
  return timeSinceLastSync > SYNC_INTERVAL;
}

/**
 * Get sync statistics (how many entries need syncing)
 * NOTE: This estimates without fetching audio - actual sync will verify each entry
 */
export async function getSyncStats(): Promise<{
  cachedAudioCount: number;
  entriesNeedingSync: number;
}> {
  try {
    const audioEntries = await audioCache.getAllEntries();
    const historyResult = await historyService.fetchHistory({ includeAudio: false }); // Don't fetch audio, just check which need it
    // Handle both old format (array) and new format (object with entries)
    const journalEntries = Array.isArray(historyResult) ? historyResult : historyResult.entries || [];

    const reflectionHashMap = new Map<string, string>();
    for (const entry of journalEntries) {
      const reflectionHash = hashText(entry.reflection);
      reflectionHashMap.set(reflectionHash, entry.id);
    }

    // Estimate entries needing sync by counting cached audio that matches journal entries
    // We don't actually fetch audio here - that only happens when user clicks play or during actual sync
    let entriesNeedingSync = 0;

    for (const audioEntry of audioEntries) {
      const entryId = reflectionHashMap.get(audioEntry.textHash);
      if (entryId) {
        // Count as potentially needing sync - actual sync will verify if audio already exists in DB
        // We don't fetch audio here to avoid unnecessary network requests
        // Audio is only fetched when user clicks the speaker icon
        entriesNeedingSync++;
      }
    }

    return {
      cachedAudioCount: audioEntries.length,
      entriesNeedingSync,
    };
  } catch (error) {
    console.error('[audioSync] Failed to get sync stats:', error);
    return {
      cachedAudioCount: 0,
      entriesNeedingSync: 0,
    };
  }
}

/**
 * Sync audio from IndexedDB to database in the background
 * Runs automatically and updates progress via callback
 */
export async function syncAudioToDatabase(
  onProgress?: (progress: AudioSyncProgress) => void
): Promise<{ success: boolean; saved: number; errors: number }> {
  const state = getSyncState();

  // Don't run if already running
  if (state.isRunning) {
    console.log('[audioSync] Sync already running, skipping');
    return { success: false, saved: 0, errors: 0 };
  }

  // Update state to indicate sync is running
  const newState: AudioSyncState = {
    isRunning: true,
    lastSyncTime: state.lastSyncTime,
    progress: {
      total: 0,
      processed: 0,
      matched: 0,
      saved: 0,
      errors: 0,
      isComplete: false,
    },
    error: null,
  };
  saveSyncState(newState);

  try {
    console.log('[audioSync] Starting background audio sync...');

    // Get all cached audio entries
    const audioEntries = await audioCache.getAllEntries();
    if (audioEntries.length === 0) {
      console.log('[audioSync] No audio entries to sync');
      saveSyncState({
        isRunning: false,
        lastSyncTime: Date.now(),
        progress: null,
        error: null,
      });
      return { success: true, saved: 0, errors: 0 };
    }

    // Get journal entries (without audio for performance)
    const historyResult = await historyService.fetchHistory({ includeAudio: false });
    // Handle both old format (array) and new format (object with entries)
    const journalEntries = Array.isArray(historyResult) ? historyResult : historyResult.entries || [];

    if (journalEntries.length === 0) {
      console.log('[audioSync] No journal entries found');
      saveSyncState({
        isRunning: false,
        lastSyncTime: Date.now(),
        progress: null,
        error: null,
      });
      return { success: true, saved: 0, errors: 0 };
    }

    // Create hash map for matching
    const reflectionHashMap = new Map<string, typeof journalEntries[0]>();
    for (const entry of journalEntries) {
      const reflectionHash = hashText(entry.reflection);
      reflectionHashMap.set(reflectionHash, entry);
    }

    let saved = 0;
    let errors = 0;
    let matched = 0;

    // Process audio entries in batches to avoid blocking
    const BATCH_SIZE = 3; // Process 3 at a time
    for (let i = 0; i < audioEntries.length; i += BATCH_SIZE) {
      const batch = audioEntries.slice(i, i + BATCH_SIZE);

      // Process batch and capture results to count successes/failures accurately
      const results = await Promise.allSettled(
        batch.map(async (audioEntry) => {
          const matchingEntry = reflectionHashMap.get(audioEntry.textHash);
          if (!matchingEntry) {
            return { type: 'no_match' as const };
          }

          // Check if entry already has audio in DB (lightweight check, doesn't fetch audio)
          const hasAudio = await historyService.checkEntryAudioExists(matchingEntry.id);
          if (hasAudio) {
            return { type: 'already_synced' as const, entryId: matchingEntry.id };
          }

          try {
            // Save directly
            await historyService.saveEntryAudio(matchingEntry.id, audioEntry.audioBase64);
            console.log(`[audioSync] ✅ Synced audio for entry ${matchingEntry.id}`);
            return { type: 'saved' as const, entryId: matchingEntry.id };
          } catch (error: any) {
            console.error(`[audioSync] ❌ Error syncing audio for entry ${matchingEntry.id}:`, error);

            // Try saving original as fallback
            try {
              await historyService.saveEntryAudio(matchingEntry.id, audioEntry.audioBase64);
              console.log(`[audioSync] ✅ Saved original audio for entry ${matchingEntry.id}`);
              return { type: 'saved' as const, entryId: matchingEntry.id };
            } catch (fallbackError) {
              console.error(`[audioSync] ❌ Fallback save failed:`, fallbackError);
              return { type: 'error' as const, entryId: matchingEntry.id, error: fallbackError };
            }
          }
        })
      );

      // Count results from the batch
      for (const result of results) {
        if (result.status === 'fulfilled') {
          const value = result.value;
          if (value.type === 'saved') {
            matched++;
            saved++;
          } else if (value.type === 'error') {
            matched++;
            errors++;
          } else if (value.type === 'no_match' || value.type === 'already_synced') {
            // Don't count these
          }
        } else {
          // Promise rejected
          errors++;
        }
      }

      // Update progress after counting batch results
      const processed = Math.min(i + BATCH_SIZE, audioEntries.length);
      const progress: AudioSyncProgress = {
        total: audioEntries.length,
        processed,
        matched,
        saved,
        errors,
        isComplete: processed >= audioEntries.length,
      };

      newState.progress = progress;
      saveSyncState(newState);

      if (onProgress) {
        onProgress(progress);
      }

      // Small delay between batches to avoid overwhelming the browser
      if (processed < audioEntries.length) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    // Mark sync as complete
    saveSyncState({
      isRunning: false,
      lastSyncTime: Date.now(),
      progress: {
        ...newState.progress!,
        isComplete: true,
      },
      error: null,
    });

    console.log(`[audioSync] ✅ Sync complete: ${saved}/${audioEntries.length} audio files synced`);
    return { success: true, saved, errors };
  } catch (error: any) {
    console.error('[audioSync] Sync failed:', error);
    saveSyncState({
      isRunning: false,
      lastSyncTime: state.lastSyncTime,
      progress: newState.progress,
      error: error?.message || 'Sync failed',
    });
    return { success: false, saved: 0, errors: 1 };
  }
}

