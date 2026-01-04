/**
 * Shared utility for hashing text consistently across the application
 * Used for matching audio cache entries with journal entries by reflection text
 */

/**
 * Hash text using a simple, consistent algorithm
 * Same implementation used in AudioCache, audioSync, and audioMigration
 */
export function hashText(text: string): string {
  let hash = 0;
  const normalized = text.trim().toLowerCase();
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString(36);
}

/**
 * Hash TTS input (text + voice ID) for cache key
 * Used for S3 storage and TTS caching
 * @param text - Text to hash
 * @param voiceId - Voice ID (optional, defaults to default voice)
 * @returns Hash string
 */
export function hashTTSInput(text: string, voiceId?: string): string {
  const normalizedText = text.trim().toLowerCase();
  const voice = voiceId || 'default';
  const input = `${normalizedText}:${voice}`;
  
  // Use simple hash for now (can be upgraded to SHA-256 if needed)
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString(36);
}
