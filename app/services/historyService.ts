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
    entities: dbEntry.entities as any || undefined, // Parse entities from JSON
    highlights: dbEntry.highlights as any || undefined, // Parse highlights from JSON
  };
}

// Convert HistoryEntry to API format (for POST requests)
function fromHistoryEntry(entry: HistoryEntry) {
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
  // Returns entries and pagination info if limit/offset are provided
  async fetchHistory(options?: { limit?: number; offset?: number }): Promise<HistoryEntry[] | HistoryFetchResult> {
    try {
      const params = new URLSearchParams();
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
  async saveEntries(entries: HistoryEntry[]): Promise<void> {
    if (entries.length === 0) {
      log.debug('No entries to save, skipping');
      return;
    }

    try {
      const entriesData = entries.map(entry => fromHistoryEntry(entry));
      log.info(`Saving ${entries.length} entries to database`);

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
