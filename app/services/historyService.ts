import { HistoryEntry, Mood } from '../types';

// Prisma returns camelCase field names
interface PrismaJournalEntry {
  id: string;
  userId: string;
  entryText: string;
  reflectionText: string;
  summary?: string | null;
  topic?: string | null;
  mood?: string | null;
  audioData?: string | null; // Compressed audio (base64)
  createdAt: Date | string;
  updatedAt: Date | string;
}

interface UserPreferences {
  auto_play_enabled: boolean;
}

// Convert Prisma entry to HistoryEntry
function toHistoryEntry(dbEntry: PrismaJournalEntry): HistoryEntry {
  return {
    id: dbEntry.id,
    text: dbEntry.entryText,
    summary: dbEntry.summary || undefined,
    reflection: dbEntry.reflectionText,
    mood: (dbEntry.mood as Mood) || 'none',
    topic: dbEntry.topic || undefined,
    timestamp: typeof dbEntry.createdAt === 'string'
      ? dbEntry.createdAt
      : dbEntry.createdAt.toISOString(),
    chatHistory: [], // Initialize empty - chat history is not persisted to DB
    audioBase64: dbEntry.audioData || undefined, // Load audio from database
  };
}

// Convert HistoryEntry to API format (for POST requests)
// IMPORTANT: Only include audio_data if it exists in memory - don't send null/undefined
// to avoid overwriting existing audio in database when syncing from another device
function fromHistoryEntry(entry: HistoryEntry, includeAudio = false) {
  const result: any = {
    id: entry.id,
    entry_text: entry.text,
    reflection_text: entry.reflection,
    summary: entry.summary || null,
    topic: entry.topic || null,
    mood: entry.mood !== 'none' ? entry.mood : null,
    created_at: entry.timestamp,
  };

  // Only include audio_data if:
  // 1. explicitly requested (includeAudio = true)
  // 2. AND audioBase64 actually exists (not undefined/null)
  // This prevents overwriting existing audio in DB when syncing from device without audio in memory
  if (includeAudio && entry.audioBase64) {
    result.audio_data = entry.audioBase64;
  }
  // If includeAudio is false or audioBase64 is missing, don't include audio_data field
  // This means the API won't update the audio field, preserving existing audio in DB

  return result;
}

export const historyService = {
  // Fetch all entries for current user (via API route)
  // By default, excludes audioData for faster queries (audio is large)
  async fetchHistory(options?: { includeAudio?: boolean; limit?: number; offset?: number }): Promise<HistoryEntry[]> {
    try {
      const params = new URLSearchParams();
      if (options?.includeAudio) {
        params.set('includeAudio', 'true');
      }
      if (options?.limit) {
        params.set('limit', options.limit.toString());
      }
      if (options?.offset) {
        params.set('offset', options.offset.toString());
      }

      const url = `/api/history${params.toString() ? `?${params.toString()}` : ''}`;
      console.log('[historyService] Fetching history from API...', options);
      const response = await fetch(url);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[historyService] API error: ${response.status}`, errorText);
        if (response.status === 500) {
          // Database not configured, return empty array
          console.warn('[historyService] Database not configured or error occurred');
          return [];
        }
        if (response.status === 401) {
          console.warn('[historyService] Unauthorized - user not logged in');
          return [];
        }
        throw new Error(`Failed to fetch history: ${response.status}`);
      }

      const data = await response.json();
      console.log('[historyService] Received response:', data);

      const entries = data.entries || [];
      console.log(`[historyService] Converting ${entries.length} entries`);

      const converted = entries.map(toHistoryEntry);
      console.log(`[historyService] ✅ Successfully converted ${converted.length} entries`);
      return converted;
    } catch (error) {
      console.error('[historyService] Failed to fetch history:', error);
      return [];
    }
  },

  // Save multiple entries (batch) via API route
  // includeAudio: if true, includes audio data in the save (use when audio is in memory)
  // if false, audio field is omitted to preserve existing audio in database
  async saveEntries(entries: HistoryEntry[], includeAudio = false): Promise<void> {
    if (entries.length === 0) {
      console.log('[historyService] No entries to save, skipping');
      return;
    }

    try {
      const entriesData = entries.map(entry => fromHistoryEntry(entry, includeAudio));
      console.log(`[historyService] Saving ${entries.length} entries to database${includeAudio ? ' (with audio)' : ' (audio excluded to preserve DB audio)'}`);

      const response = await fetch('/api/history', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ entries: entriesData }),
      });

      if (!response.ok) {
        // Try to get error details from response
        let errorData: any = {};
        try {
          const text = await response.text();
          if (text) {
            errorData = JSON.parse(text);
          }
        } catch (parseError) {
          console.warn('[historyService] Failed to parse error response:', parseError);
          errorData = { message: response.statusText || 'Unknown error' };
        }

        console.error(`[historyService] Save failed with status ${response.status}:`, errorData);
        console.error(`[historyService] Error details:`, {
          status: response.status,
          statusText: response.statusText,
          errorData,
        });

        if (response.status === 500) {
          // Check if it's a database configuration issue
          if (errorData.error === 'Database not configured' || errorData.code === 'DATABASE_NOT_CONFIGURED') {
            console.warn('[historyService] Database not configured, entries not saved');
            return;
          }
          // For other 500 errors, throw so caller can handle
          throw new Error(`Database error: ${errorData.message || errorData.error || 'Failed to save entries'}`);
        }
        throw new Error(`Failed to save entries: ${errorData.message || errorData.error || response.statusText}`);
      }

      const result = await response.json();
      console.log(`[historyService] ✅ Successfully saved entries:`, result);
    } catch (error) {
      console.error('[historyService] Failed to save entries:', error);
      // Don't throw - allow app to continue working even if save fails
      throw error; // But let caller know it failed
    }
  },

  // Check if audio exists for a specific entry (lightweight check, doesn't fetch audio)
  async checkEntryAudioExists(entryId: string): Promise<boolean> {
    try {
      const response = await fetch(`/api/history/audio?entryId=${encodeURIComponent(entryId)}&checkOnly=true`, {
        method: 'GET',
      });

      if (!response.ok) {
        if (response.status === 404) {
          return false;
        }
        return false;
      }

      const data = await response.json();
      return data.exists === true;
    } catch (error) {
      console.error('[historyService] Failed to check audio exists:', error);
      return false;
    }
  },

  // Fetch audio data for a specific entry (on-demand loading - only when user clicks play)
  async fetchEntryAudio(entryId: string): Promise<string | null> {
    try {
      const response = await fetch(`/api/history/audio?entryId=${encodeURIComponent(entryId)}`, {
        method: 'GET',
      });

      if (!response.ok) {
        if (response.status === 404) {
          // Audio not found - entry might not have audio yet
          console.log(`[historyService] Audio not found for entry ${entryId}`);
          return null;
        }
        if (response.status === 500) {
          console.warn('[historyService] Database not configured');
          return null;
        }
        throw new Error(`Failed to fetch audio: ${response.status}`);
      }

      const data = await response.json();
      console.log(`[historyService] ✅ Successfully fetched audio for entry ${entryId}`);
      return data.audioData || null;
    } catch (error) {
      console.error('[historyService] Failed to fetch audio:', error);
      return null;
    }
  },

  // Save audio data for a specific entry (async optimization)
  async saveEntryAudio(entryId: string, audioData: string): Promise<void> {
    try {
      const response = await fetch('/api/history/audio', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ entryId, audioData }),
      });

      if (!response.ok) {
        if (response.status === 500) {
          console.warn('[historyService] Database not configured, audio not saved');
          return;
        }
        throw new Error('Failed to save audio');
      }

      console.log(`[historyService] ✅ Successfully saved audio for entry ${entryId}`);
    } catch (error) {
      console.error('[historyService] Failed to save audio:', error);
      // Don't throw - audio save failure shouldn't break the app
    }
  },

  // Delete an entry via API route
  async deleteEntry(entryId: string): Promise<void> {
    try {
      const response = await fetch(`/api/history?id=${entryId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        if (response.status === 500) {
          console.warn('Database not configured, entry not deleted');
          return;
        }
        throw new Error('Failed to delete entry');
      }
    } catch (error) {
      console.error('Failed to delete entry:', error);
      throw error;
    }
  },

  // Delete all entries for current user via API route
  async deleteAllEntries(): Promise<void> {
    try {
      const response = await fetch('/api/history?all=true', {
        method: 'DELETE',
      });

      if (!response.ok) {
        if (response.status === 500) {
          console.warn('Database not configured, entries not deleted');
          return;
        }
        throw new Error('Failed to delete entries');
      }
    } catch (error) {
      console.error('Failed to delete all entries:', error);
      throw error;
    }
  },

  // Get user preferences via API route
  async getPreferences(): Promise<UserPreferences | null> {
    try {
      const response = await fetch('/api/preferences');

      if (!response.ok) {
        // Return null if not configured or error
        return null;
      }

      const { preferences } = await response.json();
      return preferences;
    } catch (error) {
      console.error('Failed to fetch preferences:', error);
      return null;
    }
  },

  // Save user preferences via API route
  async savePreferences(preferences: UserPreferences): Promise<void> {
    try {
      const response = await fetch('/api/preferences', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(preferences),
      });

      if (!response.ok) {
        if (response.status === 500) {
          // Database not configured, silently fail
          console.warn('Database not configured, preferences not saved');
          return;
        }
        throw new Error('Failed to save preferences');
      }
    } catch (error) {
      console.error('Failed to save preferences:', error);
      // Don't throw - allow app to continue
    }
  },
};
