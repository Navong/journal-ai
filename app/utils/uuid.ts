/**
 * Generate a UUID v4
 * Uses crypto.randomUUID() if available, otherwise falls back to a manual implementation
 */
export function generateUUID(): string {
  // Check if crypto.randomUUID is available (browser and Node.js 19.6+)
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  // Fallback implementation for environments without crypto.randomUUID
  // This is a simple UUID v4 generator
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

