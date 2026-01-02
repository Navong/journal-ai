/**
 * Memory Confidence Layer for MMA Architecture
 * 
 * Calculates confidence scores for retrieved context items before surfacing
 * them in AI reflections. Prevents hallucinations and authority creep.
 * 
 * Formula: memoryConfidence = semantic(0.60) + recency(0.25) + recurrence(0.15)
 */

import { HistoryEntry } from '../types';
import logger from './logger';

const log = logger.module('MemoryConfidence');

// Confidence band thresholds
const CONFIDENCE_BANDS = {
  HIGH: 0.85,
  MEDIUM: 0.65,
  LOW: 0.45,
} as const;

// Weight configuration
const WEIGHTS = {
  SEMANTIC: 0.60,
  RECENCY: 0.25,
  RECURRENCE: 0.15,
} as const;

/**
 * Confidence band types
 */
export type ConfidenceBand = 'high' | 'medium' | 'low' | 'exclude';

/**
 * Result of memory confidence calculation
 */
export interface MemoryConfidenceResult {
  score: number;                    // 0.0 - 1.0
  band: ConfidenceBand;
  allowedLanguage: string[];        // Phrases AI can use for recall
  shouldSurface: boolean;           // false if < 0.45
}

/**
 * Input scores for confidence calculation
 */
export interface ConfidenceInputs {
  semanticSimilarity: number;       // 0.0 - 1.0 from embeddings
  recencyScore: number;             // 0.0 - 1.0 based on days ago
  recurrenceScore: number;          // 0.0 - 1.0 based on mention count
}

/**
 * Context item with confidence scoring
 */
export interface ContextItemWithConfidence {
  entry: HistoryEntry;
  semanticScore: number;
  recencyScore: number;
  recurrenceScore: number;
  confidence: MemoryConfidenceResult;
}

/**
 * Language rules for each confidence band
 */
const LANGUAGE_RULES: Record<ConfidenceBand, string[]> = {
  high: [
    'You mentioned...',
    'You wrote about...',
    'You shared that...',
    'In your entry, you described...',
  ],
  medium: [
    'It seems like...',
    'There may be a connection to...',
    'This seems to relate to...',
    'It appears that...',
  ],
  low: [
    'This might connect to...',
    'This could relate to...',
    'There may be some resonance with...',
    'This possibly touches on...',
  ],
  exclude: [], // Should never be used
};

/**
 * Calculate recency score based on how many days ago the entry was
 * More recent = higher score
 */
export function calculateRecencyScore(entryTimestamp: string | Date): number {
  const entryDate = new Date(entryTimestamp);
  const now = new Date();
  
  // Validate date
  if (isNaN(entryDate.getTime())) {
    log.warn('Invalid entry timestamp for recency calculation', { entryTimestamp });
    return 0.1;
  }
  
  const daysDiff = Math.floor((now.getTime() - entryDate.getTime()) / (1000 * 60 * 60 * 24));
  
  // Recency scoring curve
  if (daysDiff <= 0) return 1.0;       // Today
  if (daysDiff === 1) return 0.95;     // Yesterday
  if (daysDiff <= 3) return 0.85;      // Last 3 days
  if (daysDiff <= 7) return 0.70;      // Last week
  if (daysDiff <= 14) return 0.50;     // Last 2 weeks
  if (daysDiff <= 30) return 0.30;     // Last month
  if (daysDiff <= 60) return 0.20;     // Last 2 months
  return 0.10;                          // Older than 2 months
}

/**
 * Calculate recurrence score based on how often an entity/topic appears
 * More mentions = higher score
 */
export function calculateRecurrenceScore(mentionCount: number): number {
  if (mentionCount >= 10) return 1.0;   // Very frequent
  if (mentionCount >= 7) return 0.9;    // Frequent
  if (mentionCount >= 5) return 0.8;    // Regular
  if (mentionCount >= 3) return 0.6;    // Recurring
  if (mentionCount >= 2) return 0.4;    // Mentioned twice
  return 0.15;                           // Single mention
}

/**
 * Calculate recurrence score for an entry based on entity overlap with history
 */
export function calculateEntryRecurrenceScore(
  entry: HistoryEntry,
  allHistory: HistoryEntry[]
): number {
  if (!entry.entities) return 0.15;
  
  const entryEntities = new Set<string>();
  
  // Collect all entities from this entry (lowercase for comparison)
  entry.entities.people?.forEach(p => entryEntities.add(p.toLowerCase()));
  entry.entities.places?.forEach(p => entryEntities.add(p.toLowerCase()));
  entry.entities.organizations?.forEach(o => entryEntities.add(o.toLowerCase()));
  entry.entities.events?.forEach(e => entryEntities.add(e.name.toLowerCase()));
  
  if (entryEntities.size === 0) return 0.15;
  
  // Count how many times these entities appear across all history
  let totalMentions = 0;
  
  allHistory.forEach(historyEntry => {
    if (historyEntry.id === entry.id) return; // Skip self
    if (!historyEntry.entities) return;
    
    const historyEntities = new Set<string>();
    historyEntry.entities.people?.forEach(p => historyEntities.add(p.toLowerCase()));
    historyEntry.entities.places?.forEach(p => historyEntities.add(p.toLowerCase()));
    historyEntry.entities.organizations?.forEach(o => historyEntities.add(o.toLowerCase()));
    historyEntry.entities.events?.forEach(e => historyEntities.add(e.name.toLowerCase()));
    
    // Count overlapping entities
    entryEntities.forEach(entity => {
      if (historyEntities.has(entity)) {
        totalMentions++;
      }
    });
  });
  
  // Calculate score based on total cross-entry mentions
  return calculateRecurrenceScore(totalMentions);
}

/**
 * Determine confidence band from score
 */
export function getConfidenceBand(score: number): ConfidenceBand {
  if (score >= CONFIDENCE_BANDS.HIGH) return 'high';
  if (score >= CONFIDENCE_BANDS.MEDIUM) return 'medium';
  if (score >= CONFIDENCE_BANDS.LOW) return 'low';
  return 'exclude';
}

/**
 * Main function: Calculate memory confidence for a context item
 */
export function calculateMemoryConfidence(inputs: ConfidenceInputs): MemoryConfidenceResult {
  const { semanticSimilarity, recencyScore, recurrenceScore } = inputs;
  
  // Validate inputs (clamp to 0-1 range)
  const clamp = (val: number) => Math.max(0, Math.min(1, val));
  
  const semantic = clamp(semanticSimilarity);
  const recency = clamp(recencyScore);
  const recurrence = clamp(recurrenceScore);
  
  // Calculate weighted score
  const score = 
    semantic * WEIGHTS.SEMANTIC +
    recency * WEIGHTS.RECENCY +
    recurrence * WEIGHTS.RECURRENCE;
  
  // Determine band
  const band = getConfidenceBand(score);
  
  // Get allowed language
  const allowedLanguage = LANGUAGE_RULES[band];
  
  // Determine if should surface
  const shouldSurface = band !== 'exclude';
  
  log.debug('Memory confidence calculated', {
    inputs: { semantic, recency, recurrence },
    score: score.toFixed(3),
    band,
    shouldSurface
  });
  
  return {
    score,
    band,
    allowedLanguage,
    shouldSurface
  };
}

/**
 * Calculate confidence for a history entry in context selection
 */
export function calculateEntryConfidence(
  entry: HistoryEntry,
  semanticSimilarity: number,
  allHistory: HistoryEntry[]
): ContextItemWithConfidence {
  const recencyScore = calculateRecencyScore(entry.timestamp);
  const recurrenceScore = calculateEntryRecurrenceScore(entry, allHistory);
  
  const confidence = calculateMemoryConfidence({
    semanticSimilarity,
    recencyScore,
    recurrenceScore
  });
  
  return {
    entry,
    semanticScore: semanticSimilarity,
    recencyScore,
    recurrenceScore,
    confidence
  };
}

/**
 * Format confidence label for context prompt
 */
export function formatConfidenceLabel(confidence: MemoryConfidenceResult): string {
  const bandLabels: Record<ConfidenceBand, string> = {
    high: 'HIGH CONFIDENCE',
    medium: 'MEDIUM CONFIDENCE',
    low: 'LOW CONFIDENCE',
    exclude: 'EXCLUDED'
  };
  
  const languageHint = confidence.allowedLanguage[0] || '';
  
  return `[Memory: ${bandLabels[confidence.band]}${languageHint ? ` — Use: "${languageHint}"` : ''}]`;
}

/**
 * Filter context items by confidence threshold
 * Returns only items that should be surfaced
 */
export function filterByConfidence(
  items: ContextItemWithConfidence[]
): ContextItemWithConfidence[] {
  return items.filter(item => item.confidence.shouldSurface);
}

/**
 * Get aggregate confidence language rules for prompt
 */
export function getConfidenceLanguageRules(): string {
  return `
## MEMORY RECALL RULES

When referencing past entries, use language that matches your confidence level:

| Confidence | Allowed Language |
|------------|------------------|
| HIGH | "You mentioned...", "You wrote about...", "You shared that..." |
| MEDIUM | "It seems like...", "There may be a connection to...", "This seems to relate to..." |
| LOW | "This might connect to...", "This could relate to...", "There may be some resonance with..." |

**Critical Rules:**
- ❌ NEVER use timestamps ("In January...", "Last week...", "A month ago...") unless the USER explicitly mentioned time
- ❌ NEVER say "we've seen this impacting you" — you have no authority over the user's experience
- ❌ NEVER surface memories you're uncertain about (below LOW confidence)
- ❌ NEVER state past context as definite fact — always use appropriate recall language
`;
}
