// IndexedDB audio cache utility
import { hashText } from './textHash';

const DB_NAME = 'serenity-journal-audio-cache';
const DB_VERSION = 1;
const STORE_NAME = 'audio';

interface AudioCacheEntry {
  textHash: string;
  audioBase64: string;
  timestamp: number;
}

export class AudioCache {
  private db: IDBDatabase | null = null;
  private initPromise: Promise<void> | null = null;
  private readonly MAX_CACHE_SIZE = 50 * 1024 * 1024; // 50MB
  private readonly MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days

  private async init(): Promise<void> {
    if (this.db) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'textHash' });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };
    });

    return this.initPromise;
  }

  async get(text: string): Promise<string | null> {
    try {
      await this.init();
      if (!this.db) return null;

      const textHash = hashText(text);
      return new Promise((resolve, reject) => {
        const transaction = this.db!.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(textHash);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const entry = request.result as AudioCacheEntry | undefined;
          if (!entry) {
            resolve(null);
            return;
          }

          // Check if entry is too old
          const age = Date.now() - entry.timestamp;
          if (age > this.MAX_AGE) {
            // Delete old entry
            this.delete(textHash);
            resolve(null);
            return;
          }

          resolve(entry.audioBase64);
        };
      });
    } catch (error) {
      console.error('Audio cache get error:', error);
      return null;
    }
  }

  async set(text: string, audioBase64: string): Promise<void> {
    try {
      await this.init();
      if (!this.db) return;

      const textHash = hashText(text);
      const entry: AudioCacheEntry = {
        textHash,
        audioBase64,
        timestamp: Date.now(),
      };

      await new Promise<void>((resolve, reject) => {
        const transaction = this.db!.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.put(entry);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          this.cleanup(); // Cleanup in background
          resolve();
        };
      });
    } catch (error) {
      console.error('Audio cache set error:', error);
    }
  }

  private async delete(textHash: string): Promise<void> {
    if (!this.db) return;
    const transaction = this.db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    store.delete(textHash);
  }

  private async cleanup(): Promise<void> {
    try {
      if (!this.db) return;

      const transaction = this.db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index('timestamp');
      const request = index.openCursor(null, 'prev'); // Oldest first

      let totalSize = 0;
      const entries: { key: string; size: number; timestamp: number }[] = [];

      await new Promise<void>((resolve) => {
        request.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
          if (!cursor) {
            resolve();
            return;
          }

          const entry = cursor.value as AudioCacheEntry;
          const size = entry.audioBase64.length;
          const age = Date.now() - entry.timestamp;

          // Remove entries older than MAX_AGE
          if (age > this.MAX_AGE) {
            cursor.delete();
            cursor.continue();
            return;
          }

          totalSize += size;
          entries.push({
            key: entry.textHash,
            size,
            timestamp: entry.timestamp,
          });

          cursor.continue();
        };
      });

      // If cache is too large, remove oldest entries
      if (totalSize > this.MAX_CACHE_SIZE) {
        entries.sort((a, b) => a.timestamp - b.timestamp);
        for (const entry of entries) {
          if (totalSize <= this.MAX_CACHE_SIZE * 0.8) break; // Remove until 80% of max
          totalSize -= entry.size;
          await this.delete(entry.key);
        }
      }
    } catch (error) {
      console.error('Audio cache cleanup error:', error);
    }
  }

  async clear(): Promise<void> {
    try {
      await this.init();
      if (!this.db) return;

      const transaction = this.db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      await new Promise<void>((resolve, reject) => {
        const request = store.clear();
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
      });
    } catch (error) {
      console.error('Audio cache clear error:', error);
    }
  }

  /**
   * Get all cached audio entries (for migration)
   * Returns array of { textHash, audioBase64, timestamp }
   */
  async getAllEntries(): Promise<Array<{ textHash: string; audioBase64: string; timestamp: number }>> {
    try {
      await this.init();
      if (!this.db) return [];

      return new Promise((resolve, reject) => {
        const transaction = this.db!.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();

        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const entries = (request.result as AudioCacheEntry[]).map(entry => ({
            textHash: entry.textHash,
            audioBase64: entry.audioBase64,
            timestamp: entry.timestamp,
          }));
          resolve(entries);
        };
      });
    } catch (error) {
      console.error('Audio cache getAllEntries error:', error);
      return [];
    }
  }

  /**
   * Public method to hash text (for migration matching)
   * @deprecated Use hashText from './textHash' directly instead
   */
  public hashTextPublic(text: string): string {
    return hashText(text);
  }
}

export const audioCache = new AudioCache();
