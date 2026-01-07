// Context configuration constants
export const MAX_CONTEXT_TOKENS_REFLECTION = 2500;
export const MAX_CONTEXT_TOKENS_CHAT = 1500;
export const DAYS_RECENT = 3; // Entries within this many days use full text
export const DAYS_MEDIUM = 14; // Entries within this many days use summaries
export const SEMANTIC_WEIGHT = 0.75; // Semantic similarity weight (75%)
export const MOOD_WEIGHT = 0.25; // Mood/emotion metadata weight (25%)
export const MIN_RELEVANCE_SCORE = 0.3; // Minimum relevance score to include entry
export const RE_RANK_TOP_K = 20; // Top K entries to re-rank (lightweight post-filter)
export const MODEL_NAME = 'gemini-3-flash-preview';
export const CACHE_TTL_SECONDS = 3600; // 1 hour (default TTL)
