import { HistoryEntry, Mood } from '../types';
import logger from '../utils/logger';

const log = logger;

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
  entities?: any; // JSON field for extracted entities
  highlights?: any; // JSON field for AI-detected highlights
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
    entities: dbEntry.entities as any || undefined, // Parse entities from JSON
    highlights: dbEntry.highlights as any || undefined, // Parse highlights from JSON
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
    // Always include mood - save detected mood to database
    // If mood is 'none' or undefined, save as null (DB stores null for 'none')
    // If mood is detected (anxious, calm, etc.), save the actual value
    // IMPORTANT: Always include mood field, even if it's 'none' (saved as null)
    mood: (entry.mood && entry.mood !== 'none') ? entry.mood : null,
    created_at: entry.timestamp,
    // Include entities if available (stored as JSON in database)
    entities: entry.entities || null,
    // Include highlights if available (stored as JSON in database)
    highlights: entry.highlights || null,
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

export interface HistoryFetchResult {
  entries: HistoryEntry[];
  hasMore?: boolean;
  pagination?: {
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

export const historyService = {
  // Fetch entries for current user (via API route)
  // By default, excludes audioData for faster queries (audio is large)
  // Returns entries and pagination info if limit/offset are provided
  async fetchHistory(options?: { includeAudio?: boolean; limit?: number; offset?: number }): Promise<HistoryEntry[] | HistoryFetchResult> {
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
      log.debug('Fetching history from API', options);
      const response = await fetch(url);

      if (!response.ok) {
        const errorText = await response.text();
        log.error(`API error: ${response.status}`, { status: response.status, errorText });
        if (response.status === 500) {
          // Check if it's a timeout error
          if (errorText.includes('timeout') || errorText.includes('Connection terminated')) {
            log.warn('Database connection timeout - returning empty array', { errorText });
            return options?.limit ? { entries: [], hasMore: false } : [];
          }
          // Database not configured or other error, return empty array
          log.warn('Database not configured or error occurred', { errorText });
          return options?.limit ? { entries: [], hasMore: false } : [];
        }
        if (response.status === 401) {
          log.warn('Unauthorized - user not logged in');
          return options?.limit ? { entries: [], hasMore: false } : [];
        }
        throw new Error(`Failed to fetch history: ${response.status}`);
      }

      const data = await response.json();
      log.debug('Received response', { entryCount: data.entries?.length || 0 });

      const entries = data.entries || [];
      log.debug(`Converting ${entries.length} entries`);

      const converted = entries.map(toHistoryEntry);
      log.info(`Successfully converted ${converted.length} entries`);
      
      // If pagination was requested, return result with pagination info
      if (options?.limit && data.pagination) {
        return {
          entries: converted,
          hasMore: data.pagination.hasMore,
          pagination: data.pagination
        };
      }
      
      // Otherwise return just the entries array (backward compatibility)
      return converted;
    } catch (error) {
      log.error('Failed to fetch history', {}, error as Error);
      return options?.limit ? { entries: [], hasMore: false } : [];
    }
  },

  // Save multiple entries (batch) via API route
  // includeAudio: if true, includes audio data in the save (use when audio is in memory)
  // if false, audio field is omitted to preserve existing audio in database
  async saveEntries(entries: HistoryEntry[], includeAudio = false): Promise<void> {
    if (entries.length === 0) {
      log.debug('No entries to save, skipping');
      return;
    }

    try {
      const entriesData = entries.map(entry => fromHistoryEntry(entry, includeAudio));
      log.info(`Saving ${entries.length} entries to database${includeAudio ? ' (with audio)' : ' (audio excluded to preserve DB audio)'}`);

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
          log.warn('Failed to parse error response', {}, parseError as Error);
          errorData = { message: response.statusText || 'Unknown error' };
        }

        log.error(`Save failed with status ${response.status}`, { status: response.status, errorData });

        if (response.status === 500) {
          // Check if it's a timeout error
          if (errorData.message?.includes('timeout') || errorData.message?.includes('Connection terminated')) {
            log.warn('Database connection timeout - entries not saved', { errorData });
            throw new Error('Database connection timeout. Please try again.');
          }
          // Check if it's a database configuration issue
          if (errorData.error === 'Database not configured' || errorData.code === 'DATABASE_NOT_CONFIGURED') {
            log.warn('Database not configured, entries not saved');
            return;
          }
          // For other 500 errors, throw so caller can handle
          throw new Error(`Database error: ${errorData.message || errorData.error || 'Failed to save entries'}`);
        }
        throw new Error(`Failed to save entries: ${errorData.message || errorData.error || response.statusText}`);
      }

      const result = await response.json();
      log.info(`Successfully saved entries`, { saved: result.saved, skipped: result.skipped });
    } catch (error) {
      log.error('Failed to save entries', {}, error as Error);
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
      log.error('Failed to check audio exists', {}, error as Error);
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
          log.debug(`Audio not found for entry ${entryId}`);
          return null;
        }
        if (response.status === 500) {
          log.warn('Database not configured');
          return null;
        }
        throw new Error(`Failed to fetch audio: ${response.status}`);
      }

      const data = await response.json();
      log.info(`Successfully fetched audio for entry ${entryId}`);
      return data.audioData || null;
    } catch (error) {
      log.error('Failed to fetch audio', {}, error as Error);
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
        let errorMessage = 'Failed to save audio';
        try {
          const errorData = await response.json();
          errorMessage = errorData.message || errorData.error || errorMessage;
        } catch (parseError) {
          // If response isn't JSON, use status text
          errorMessage = response.statusText || errorMessage;
        }
        
        if (response.status === 500) {
          log.warn('Database not configured, audio not saved', { entryId });
          throw new Error('Database not configured');
        }
        
        if (response.status === 400) {
          log.error('Invalid audio data rejected by server', { entryId, status: response.status, errorMessage });
          throw new Error(`Invalid audio data: ${errorMessage}`);
        }
        
        log.error('Failed to save audio', { entryId, status: response.status, errorMessage });
        throw new Error(`Failed to save audio: ${errorMessage} (${response.status})`);
      }

      log.info(`Successfully saved audio for entry ${entryId}`);
    } catch (error) {
      log.error('Failed to save audio', { entryId }, error as Error);
      // Re-throw so caller can handle it appropriately
      throw error;
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
          log.warn('Database not configured, entry not deleted');
          return;
        }
        throw new Error('Failed to delete entry');
      }
    } catch (error) {
      log.error('Failed to delete entry', {}, error as Error);
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
          log.warn('Database not configured, entries not deleted');
          return;
        }
        throw new Error('Failed to delete entries');
      }
    } catch (error) {
      log.error('Failed to delete all entries', {}, error as Error);
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
      log.error('Failed to fetch preferences', {}, error as Error);
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
          log.warn('Database not configured, preferences not saved');
          return;
        }
        throw new Error('Failed to save preferences');
      }
    } catch (error) {
      log.error('Failed to save preferences', {}, error as Error);
      // Don't throw - allow app to continue
    }
  },
};
