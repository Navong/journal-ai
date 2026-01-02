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
