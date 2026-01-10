// types/index.ts
// Core TypeScript types for the application

/**
 * Mood options for journal entries
 * Simple, easy to understand list
 */
export type Mood =
  | 'calm'
  | 'joyful'
  | 'anxious'
  | 'tired'
  | 'reflective'
  | 'heavy';

/**
 * Journal entry from database
 * Matches Prisma Entry model
 */
export interface Entry {
  id: string;
  userId: string;
  entryText: string;
  reflectionText: string | null;
  mood: Mood | null;
  audioS3Key: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Options for generating a reflection
 */
export interface ReflectionOptions {
  entryText: string;
  mood?: Mood;
  userId: string;
}

/**
 * Streaming reflection response
 * Sent chunk-by-chunk to the client
 */
export interface ReflectionChunk {
  type: 'chunk' | 'done' | 'error';
  content?: string;
  error?: string;
}

/**
 * Audio cache entry in IndexedDB
 */
export interface CachedAudio {
  key: string;        // Cache key (hash of text)
  audio: Uint8Array;  // Audio binary data
  format: 'wav' | 'mp3';
  timestamp: number;  // When cached
}

/**
 * Why these types?
 *
 * 1. Type safety: Catch errors at compile time
 * 2. IntelliSense: Auto-complete in VS Code
 * 3. Documentation: Types serve as inline docs
 * 4. Refactoring: Easy to change structure everywhere
 */
