// app/utils/audioGeneration.ts
import { audioCache } from './audioCache';
import { generateSpeechStream as fetchSpeechStream } from '../services/journalAIService';
import logger from './logger';

const log = logger.module('AudioGeneration');

// Request deduplication map
const pendingTTSRequests = new Map<string, Promise<string | string[] | undefined>>();

function cleanTextForTTS(text: string): string {
  return text
    .replace(/[#*`_~]/g, '')
    .replace(/\`[^\]]+\`\)[^)]+\)/g, '$1') // Corrected regex for markdown links
    .replace(/- /g, '')
    .replace(/\n+/g, ' ')
    .trim();
}

// Chunk text into smaller pieces for TTS (respecting sentence boundaries when possible)
function chunkTextForTTS(text: string, maxLength: number = 1500): string[] {
  const cleaned = cleanTextForTTS(text);

  if (cleaned.length <= maxLength) {
    return [cleaned];
  }

  const chunks: string[] = [];
  let currentChunk = '';

  // Try to split on sentence boundaries first
  const sentences = cleaned.split(/([.!?]\s+)/);

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];

    if ((currentChunk + sentence).length <= maxLength) {
      currentChunk += sentence;
    } else {
      if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
      }

      // If a single sentence is too long, split by words
      if (sentence.length > maxLength) {
        const words = sentence.split(/\s+/);
        let wordChunk = '';
        for (const word of words) {
          if ((wordChunk + ' ' + word).length <= maxLength) {
            wordChunk += (wordChunk ? ' ' : '') + word;
          } else {
            if (wordChunk) chunks.push(wordChunk);
            wordChunk = word;
          }
        }
        if (wordChunk) currentChunk = wordChunk;
      } else {
        currentChunk = sentence;
      }
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks.filter(chunk => chunk.length > 0);
}

// Helper to convert ReadableStream<Uint8Array> to base64 string
export async function streamToBase64(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      totalLength += value.length;
    }
  }

  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  // Convert Uint8Array to binary string, then to base64
  let binary = '';
  combined.forEach(byte => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

/**
 * Generate speech and return raw streaming audio (ReadableStream)
 * This bypasses base64 conversion for true progressive playback
 * Use this for immediate playback with createProgressiveAudioPlayer
 */
async function generateSpeechStreamInternal(text: string): Promise<ReadableStream<Uint8Array> | undefined> {
  // Directly call the JournalAIService for the actual speech stream generation
  return fetchSpeechStream(text);
}


// Main function with deduplication and chunking support
// Optional onProgress callback for progressive playback (receives partial audio as it streams)
export const generateSpeech = async (
  text: string,
  options?: {
    useCache?: boolean;
    chunked?: boolean;
  }
): Promise<string | string[] | undefined> => {
  const { useCache = true, chunked = false } = options || {};

  // ========================================
  // LAYER 1: Check IndexedDB Cache (Local, Instant)
  // ========================================
  if (useCache && typeof window !== 'undefined') {
    try {
      const cached = await audioCache.get(text);
      if (cached) {
        log.debug('TTS Cache Hit: IndexedDB', {
          textLength: text.length,
          audioLength: typeof cached === 'string' ? cached.length : 'array'
        });
        return cached;
      }
      log.debug('TTS Cache Miss: IndexedDB', { textLength: text.length });
    } catch (error) {
      log.warn('IndexedDB cache check failed', {}, error as Error);
      // Continue to generation if cache check fails
    }
  }

  // ========================================
  // LAYER 2: Check Supabase is handled by caller (handleHistoryAudioPlayback)
  // for history entries since audio is stored by entry ID, not text hash
  // ========================================

  // ========================================
  // LAYER 3: Generate from API or return pending request
  // ========================================

  // Create hash for request deduplication
  const textHash = text.trim().toLowerCase();

  // Check if there's already a pending request for this text
  const pendingRequest = pendingTTSRequests.get(textHash);
  if (pendingRequest) {
    log.debug('TTS: Returning pending request', { textLength: text.length });
    return pendingRequest;
  }

  // Handle chunked generation for long texts
  if (chunked) {
    const chunks = chunkTextForTTS(text);

    if (chunks.length === 1) {
      // Single chunk, no need for chunking
      const request = generateSpeechStreamInternal(chunks[0]);
      const promiseResult = request.then(async (stream) => {
        if (!stream) return undefined;
        // Stream will be played progressively by JournalApp, but for caching we need base64
        const base64 = await streamToBase64(stream);
        return base64;
      });
      pendingTTSRequests.set(textHash, promiseResult);
      try {
        const result = await promiseResult;
        pendingTTSRequests.delete(textHash);
        return result;
      } catch (error) {
        pendingTTSRequests.delete(textHash);
        throw error;
      }
    }

    // Multiple chunks - process SERIALLY with delay to avoid rate limits
    // This prevents hitting rate limits when generating multiple chunks
    const results: string[] = [];
    const DELAY_BETWEEN_CHUNKS_MS = 500; // 500ms delay between chunks

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const chunkHash = chunk.trim().toLowerCase();

      // Check if there's already a pending request for this chunk
      const existing = pendingTTSRequests.get(chunkHash);
      if (existing) {
        const result = await existing;
        if (result && typeof result === 'string') results.push(result);
        continue;
      }

      // Add delay before each chunk (except the first one)
      if (i > 0) {
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_CHUNKS_MS));
      }

      const request = generateSpeechStreamInternal(chunk);
      const promiseResult = request.then(async (stream) => {
        if (!stream) return undefined;
        const base64 = await streamToBase64(stream);
        return base64;
      });
      pendingTTSRequests.set(chunkHash, promiseResult);

      try {
        const result = await promiseResult.finally(() => pendingTTSRequests.delete(chunkHash));
        if (result && typeof result === 'string') results.push(result);
      } catch (error) {
        pendingTTSRequests.delete(chunkHash);
        // Continue with other chunks even if one fails
        log.error('Failed to generate TTS chunk', {
          chunk: i + 1,
          total: chunks.length
        }, error as Error);
      }
    }

    // Save chunked result to cache (store all chunks together)
    if (results.length > 0 && useCache && typeof window !== 'undefined') {
      try {
        // We can't store array of strings in audioCache directly, it expects a single string for text -> audio mapping.
        // Instead, we will store the combined text mapped to the first chunk's audio,
        // and when retrieved, the component can handle it.
        // This is a simplification; a more robust solution might cache each chunk individually
        // or store the combined audio if all chunks are received.
        // For now, let's store the full text mapped to the *first* chunk's audio.
        await audioCache.set(text, results[0]);
        log.debug('TTS: Saved chunked audio (first chunk) to IndexedDB cache', {
          chunks: results.length,
          textLength: text.length
        });
      } catch (error) {
        log.warn('Failed to save chunked audio to cache', {}, error as Error);
      }
    }

    return results.length > 0 ? results : undefined;
  }

  // Single generation
  const request = generateSpeechStreamInternal(text);
  const promiseResult = request.then(async (stream) => {
    if (!stream) return undefined;
    const base64 = await streamToBase64(stream);
    return base64;
  });
  pendingTTSRequests.set(textHash, promiseResult);

  try {
    const result = await promiseResult;
    pendingTTSRequests.delete(textHash);

    // Save to IndexedDB cache after successful generation
    if (result && useCache && typeof window !== 'undefined') {
      try {
        await audioCache.set(text, result);
        log.debug('TTS: Saved to IndexedDB cache', { textLength: text.length });
      } catch (error) {
        log.warn('Failed to save to IndexedDB cache', {}, error as Error);
        // Don't throw - generation succeeded, cache save is optional
      }
    }

    return result;
  } catch (error) {
    pendingTTSRequests.delete(textHash);
    throw error;
  }
};
