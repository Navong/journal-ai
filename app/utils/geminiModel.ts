/**
 * Gemini text model id. Prefer NEXT_PUBLIC_* so the same code works in the browser
 * (e.g. JournalApp calls reflection from the client).
 */
export function getGeminiModel(): string {
  return process.env.NEXT_PUBLIC_GEMINI_MODEL || process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite-preview';
}
