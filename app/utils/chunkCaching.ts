/**
 * Chunk caching utilities for sentence-level TTS caching
 * Implements the chunking strategy from chunk-caching-s3-base.md
 */

/**
 * Split text into meaningful chunks (sentences, phrases, or words)
 * Ensures chunks are meaningful units that don't break mid-word or mid-phrase
 * @param text - Text to split
 * @param maxLength - Maximum chunk length (default: 200)
 * @returns Array of meaningful chunks
 */
export function splitIntoSentences(text: string, maxLength: number = 200): string[] {
  if (!text || text.trim().length === 0) {
    return [];
  }

  const chunks: string[] = [];
  const normalizedText = text.trim();

  // First, split by sentence boundaries (periods, exclamation, question marks)
  // But be careful with abbreviations (Dr., Mr., Mrs., etc.)
  const sentences: string[] = [];
  let currentSentence = '';
  let i = 0;

  // Common abbreviations that shouldn't end sentences
  const abbreviationPattern = /\b(Dr|Mr|Mrs|Ms|Prof|Sr|Jr|vs|etc|e\.g|i\.e|a\.m|p\.m|U\.S|U\.K|Ph\.D|B\.A|M\.A|Inc|Corp|Ltd|St|Ave|Blvd|Rd)\.\s*$/i;

  while (i < normalizedText.length) {
    const char = normalizedText[i];
    currentSentence += char;

    // Check for sentence ending punctuation
    if (char === '.' || char === '!' || char === '?') {
      // Check if next character is space or end of text
      const nextChar = i + 1 < normalizedText.length ? normalizedText[i + 1] : '';
      
      // If followed by space or end, check if it's an abbreviation
      if (nextChar === ' ' || nextChar === '' || nextChar === '\n') {
        // Check if the part before punctuation is an abbreviation
        if (!abbreviationPattern.test(currentSentence)) {
          // This is a real sentence ending
          const sentence = currentSentence.trim();
          if (sentence.length > 0) {
            sentences.push(sentence);
          }
          currentSentence = '';
          // Skip the space after punctuation
          if (nextChar === ' ') {
            i += 2;
            continue;
          }
        }
      }
    }

    i++;
  }

  // Add remaining text if any
  const remaining = currentSentence.trim();
  if (remaining.length > 0) {
    sentences.push(remaining);
  }

  // If no sentences found, treat entire text as one chunk
  if (sentences.length === 0) {
    sentences.push(normalizedText);
  }

  // Now process each sentence - split long ones into phrases
  for (const sentence of sentences) {
    if (sentence.length <= maxLength) {
      // Sentence fits in one chunk
      chunks.push(sentence);
    } else {
      // Split long sentence into phrases (by commas, semicolons, colons)
      const phrases = splitIntoPhrases(sentence, maxLength);
      chunks.push(...phrases);
    }
  }

  return chunks.filter(chunk => chunk.trim().length > 0);
}

/**
 * Split a long sentence into meaningful phrases
 * @param sentence - Sentence to split
 * @param maxLength - Maximum chunk length
 * @returns Array of phrase chunks
 */
function splitIntoPhrases(sentence: string, maxLength: number): string[] {
  const phrases: string[] = [];
  
  // Split by commas, semicolons, colons, and dashes
  const phraseDelimiters = /([,;:—–-])\s+/g;
  const parts: string[] = [];
  let lastIndex = 0;
  let match;

  while ((match = phraseDelimiters.exec(sentence)) !== null) {
    const part = sentence.substring(lastIndex, match.index + match[0].length).trim();
    if (part.length > 0) {
      parts.push(part);
    }
    lastIndex = match.index + match[0].length;
  }

  // Add remaining part
  const remaining = sentence.substring(lastIndex).trim();
  if (remaining.length > 0) {
    parts.push(remaining);
  }

  // If no phrase delimiters found, split by spaces (words)
  if (parts.length === 0) {
    return splitIntoWords(sentence, maxLength);
  }

  // Combine parts into chunks that don't exceed maxLength
  let currentChunk = '';
  for (const part of parts) {
    if (currentChunk.length + part.length + 1 <= maxLength) {
      // Add to current chunk
      currentChunk = currentChunk ? `${currentChunk} ${part}` : part;
    } else {
      // Save current chunk and start new one
      if (currentChunk) {
        phrases.push(currentChunk);
      }
      // If part itself is too long, split it further
      if (part.length > maxLength) {
        phrases.push(...splitIntoWords(part, maxLength));
        currentChunk = '';
      } else {
        currentChunk = part;
      }
    }
  }

  // Add final chunk
  if (currentChunk) {
    phrases.push(currentChunk);
  }

  return phrases.filter(p => p.trim().length > 0);
}

/**
 * Split text into words as last resort (ensures we never break mid-word)
 * @param text - Text to split
 * @param maxLength - Maximum chunk length
 * @returns Array of word chunks
 */
function splitIntoWords(text: string, maxLength: number): string[] {
  const words = text.split(/\s+/);
  const chunks: string[] = [];
  let currentChunk = '';

  for (const word of words) {
    // If adding this word would exceed maxLength, start a new chunk
    const potentialLength = currentChunk ? `${currentChunk} ${word}`.length : word.length;
    
    if (potentialLength > maxLength && currentChunk) {
      chunks.push(currentChunk);
      currentChunk = word;
    } else {
      currentChunk = currentChunk ? `${currentChunk} ${word}` : word;
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks.filter(c => c.trim().length > 0);
}

/**
 * Normalize a chunk for consistent hashing
 * - Trim whitespace
 * - Collapse multiple newlines/spaces to single space
 * - Standardize punctuation
 * @param chunk - Chunk to normalize
 * @returns Normalized chunk
 */
export function normalizeChunk(chunk: string): string {
  if (!chunk) {
    return '';
  }

  return chunk
    .trim()
    // Collapse multiple whitespace (spaces, tabs, newlines) to single space
    .replace(/\s+/g, ' ')
    // Remove leading/trailing spaces again after replacement
    .trim();
}

/**
 * Generate SHA-256 hash for a chunk (browser-compatible)
 * @param chunk - Normalized chunk text
 * @returns Hex string of SHA-256 hash
 */
export async function generateChunkHash(chunk: string): Promise<string> {
  if (typeof window !== 'undefined') {
    // Browser environment - use Web Crypto API
    const encoder = new TextEncoder();
    const data = encoder.encode(chunk);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  } else {
    // Node.js environment - use crypto module
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(chunk).digest('hex');
  }
}

/**
 * Generate SHA-256 hash synchronously (for Node.js only)
 * @param chunk - Normalized chunk text
 * @returns Hex string of SHA-256 hash
 */
export function generateChunkHashSync(chunk: string): string {
  if (typeof window !== 'undefined') {
    throw new Error('generateChunkHashSync can only be used in Node.js environment. Use generateChunkHash instead.');
  }
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(chunk).digest('hex');
}

/**
 * Generate S3 key for a chunk
 * @param hash - SHA-256 hash of the chunk
 * @returns S3 key in format: tts_chunks/<hash>.wav
 */
export function generateChunkS3Key(hash: string): string {
  return `tts_chunks/${hash}.wav`;
}

/**
 * Validate chunk length
 * @param chunk - Chunk to validate
 * @param maxLength - Maximum allowed length (default: 200)
 * @returns True if chunk is valid length
 */
export function validateChunkLength(chunk: string, maxLength: number = 200): boolean {
  return chunk.length <= maxLength;
}

/**
 * Process text into chunks with metadata
 * @param text - Text to process
 * @returns Array of chunk metadata
 */
export interface ChunkMetadata {
  original: string;
  normalized: string;
  hash: string;
  s3Key: string;
  isValidLength: boolean;
  index: number;
}

export async function processTextIntoChunks(text: string, maxLength: number = 200): Promise<ChunkMetadata[]> {
  const sentences = splitIntoSentences(text, maxLength);
  const chunks: ChunkMetadata[] = [];

  for (let i = 0; i < sentences.length; i++) {
    const original = sentences[i];
    const normalized = normalizeChunk(original);
    const hash = await generateChunkHash(normalized);
    const s3Key = generateChunkS3Key(hash);
    const isValidLength = validateChunkLength(normalized, maxLength);

    chunks.push({
      original,
      normalized,
      hash,
      s3Key,
      isValidLength,
      index: i,
    });
  }

  return chunks;
}

