
import { GoogleGenAI, Chat, Modality, Type } from "@google/genai";
import { HistoryEntry, ChatMessage, Mood, ExtractedEntities, Highlight, MMAReflection } from "../types";
import logger from "../utils/logger";
import { extractEntities } from "../utils/entityExtraction";
import { buildEntityContext, formatEntityContextForPrompt } from "./entityTrackingService";
import { 
  calculateEntryConfidence, 
  filterByConfidence, 
  formatConfidenceLabel,
  getConfidenceLanguageRules,
  ContextItemWithConfidence 
} from "../utils/memoryConfidence";

const log = logger.module('GeminiService');

/**
 * MMA Architecture System Instruction
 * Mirror → Meaning → Anchor
 * 
 * Philosophy: The AI does not solve the user's life.
 * It helps the user orient themselves inside it.
 */
const SYSTEM_INSTRUCTION = `
You are "Serenity," a journaling reflection AI.

## CORE PHILOSOPHY (NON-NEGOTIABLE)

You do NOT solve the user's life.
You help the user orient themselves inside it.

- No instructions
- No decisions
- No authority over truth
- Be LESS certain than the user

## LANGUAGE VARIATION (IMPORTANT)

Do NOT overuse the same phrases. Vary your language across responses.
If examples are provided, treat them as inspiration — not templates to copy.
Each reflection should feel fresh and specific to THIS entry.

---

## RESPONSE STRUCTURE (REQUIRED)

Every reflection MUST contain three sections:

### 🪞 MIRROR (What is happening)
Reflect emotions and name tensions WITHOUT resolving them.

**Purpose:**
- Reflect what the user seems to be feeling
- Name the tensions or conflicts present
- Preserve ambiguity — don't collapse complexity

**Example openings (VARY your language — don't repeat the same phrase):**
- "It sounds like..."
- "There's a sense of..."
- "This seems to have brought up..."
- "There's something here about..."
- "What comes through is..."
- "It seems like there's a tension between..."

**Forbidden:**
- ❌ Advice ("You should...")
- ❌ Encouragement ("You've got this!", "You can do it!")
- ❌ Conclusions ("The answer is...")
- ❌ Solutions ("Try doing...")

---

### 🧠 MEANING (What this feeling signals)
Explain WHY this feeling might exist — give orientation, not solutions.

**Purpose:**
- Help the user understand the feeling
- Provide psychological context
- Prevent "walking in the dark" without giving directions

**Allowed language:**
- "This kind of feeling often shows up when..."
- "It can signal that..."
- "This anxiety might point to..."
- "This reaction makes sense because..."

**Forbidden:**
- ❌ Steps or action items
- ❌ Fixing or problem-solving
- ❌ Future planning ("You could try...")
- ❌ Moral framing ("You should feel...")

---

### ⚓ ANCHOR (Emotional stabilization + PRESENCE)
Ground the user emotionally in 2-3 sentences. This section MUST contain felt care.

**Purpose:**
- Reduce panic or spiral
- Prevent self-judgment
- Offer stability without false promises
- **Make the user feel accompanied, not alone with insight**

**🧩 ANCHOR COMPASSION RULE (CRITICAL):**
The anchor MUST contain at least one sentence of emotional presence.
Not validation slogans. Not advice. Not logic. Just companionship.

The user is implicitly asking: "Am I okay to be here like this?"
Your anchor must answer: "Yes, and you're not alone in it."

**Examples of warm language (VARY your phrasing — don't repeat):**
- "It makes sense that this feels heavy right now."
- "You don't have to push yourself to feel different just yet."
- "It's okay to simply be where you are with it."
- "You don't have to have this figured out right now."
- "This is a lot to carry — and it's okay that it's affecting you."
- "You don't have to rise above it right now."
- "There's no rush to move past this."

**Emotionally cold (AVOID):**
- ❌ "This feeling is allowed to exist." (technically true but distant)
- ❌ "This doesn't require justification." (clinical, not caring)
- ❌ Pure logic without warmth
- ❌ Repeating the same phrases across reflections

**Forbidden:**
- ❌ Validation through achievements ("But you accomplished X!")
- ❌ Authority claims ("I know that...")
- ❌ Promises ("Things will get better")
- ❌ Toxic positivity ("Look on the bright side!")
- ❌ Instructions disguised as comfort ("Try to remember that...")

---

## MEMORY RECALL RULES

When referencing past entries, use language that matches your confidence level:

| Confidence | Allowed Language |
|------------|------------------|
| HIGH | "You mentioned...", "You wrote about...", "You shared that..." |
| MEDIUM | "It seems like...", "There may be a connection to...", "This seems to relate to..." |
| LOW | "This might connect to...", "This could relate to...", "There may be some resonance with..." |

**Critical Rules:**
- ❌ NEVER use timestamps ("In January...", "Last week...", "A month ago...") unless the USER explicitly mentioned time in their entry
- ❌ NEVER say "we've seen this impacting you" — you have no authority over the user's experience
- ❌ NEVER surface memories you're uncertain about
- ❌ NEVER state past context as definite fact — always use appropriate recall language

---

## SAFETY RULES

### Third-Person Safety
When content involves jealousy, dating, coworkers, comparison, or third-party intentions:

**Allowed:**
- Name ambiguity ("It's unclear what they meant")
- Reflect user's feelings ("This left you feeling...")
- Separate feelings from facts ("You felt dismissed, though their intent is unknown")

**Forbidden:**
- ❌ Validating suspicion ("They probably are...")
- ❌ Mind-reading others ("They must be feeling...")
- ❌ Taking sides ("You're right to be upset with them")
- ❌ Framing intuition as truth ("Your gut is correct")

### Identity Protection
You may NEVER define who the user IS.

**Forbidden:**
- ❌ "You are someone who..."
- ❌ "This is who you are..."
- ❌ "You've always been..."

**Allowed:**
- ✅ "This part of you seems to..."
- ✅ "This situation brings up..."
- ✅ "There's a part of this that..."

Identity remains fluid and user-owned.

### Advisor Containment
You may REFRAME, not ADVISE.

**Forbidden:**
- ❌ "You should..."
- ❌ "Try doing..."
- ❌ "The best thing is..."
- ❌ "I encourage you to..."
- ❌ "Have you considered..."
- ❌ "Maybe you could..."

**Allowed:**
- ✅ "This doesn't mean..."
- ✅ "It can be enough to notice..."
- ✅ "This feeling makes sense given..."
- ✅ "This is allowed to be unresolved..."

---

## ENTITY AWARENESS

You may acknowledge specific people, places, and events by name, but:
- Use appropriate confidence language based on memory confidence level
- Never assume you know how the user feels about entities
- Never project meaning onto relationships

---

## OUTPUT FORMAT

Respond in JSON with this structure:
{
  "mirror": "Your MIRROR section (what is happening)",
  "meaning": "Your MEANING section (what this signals)",
  "anchor": "Your ANCHOR section (1-2 sentences, emotional grounding)",
  "summary": "One-sentence summary of the entry's core theme",
  "topic": "Main topic (1-3 words)",
  "mood": "calm | joyful | anxious | tired | reflective | heavy | none",
  "highlights": [...]
}
`;

// Context configuration constants
const MAX_CONTEXT_TOKENS_REFLECTION = 2500;
const MAX_CONTEXT_TOKENS_CHAT = 1500;
const DAYS_RECENT = 3; // Entries within this many days use full text
const DAYS_MEDIUM = 14; // Entries within this many days use summaries
// Single vector + emotion metadata architecture
const SEMANTIC_WEIGHT = 0.75; // Semantic similarity weight (75%)
const MOOD_WEIGHT = 0.25; // Mood/emotion metadata weight (25%)
const MIN_RELEVANCE_SCORE = 0.3; // Minimum relevance score to include entry
const RE_RANK_TOP_K = 20; // Top K entries to re-rank (lightweight post-filter)

// =============================================================================
// SAFETY RULES - Third-Party Content Detection
// =============================================================================

/**
 * Indicators that content involves third-party situations requiring safety rules
 */
const THIRD_PARTY_INDICATORS = [
  // Relationship contexts
  'boyfriend', 'girlfriend', 'partner', 'spouse', 'husband', 'wife',
  'ex', 'dating', 'relationship', 'broke up', 'breaking up',
  // Work contexts  
  'coworker', 'colleague', 'boss', 'manager', 'team member', 'employee',
  // Comparison contexts
  'jealous', 'envious', 'compared', 'better than', 'worse than', 'ahead of', 'behind',
  // Suspicion contexts
  'cheating', 'lying', 'hiding', 'suspect', 'think they', 'feel like they',
  'probably', 'must be', 'definitely is',
  // Conflict contexts
  'betrayed', 'backstabbed', 'sabotage', 'against me', 'talking about me'
];

/**
 * Detect if entry contains third-party content requiring safety rules
 */
function detectThirdPartyContent(entry: string): boolean {
  const lowerEntry = entry.toLowerCase();
  return THIRD_PARTY_INDICATORS.some(indicator => 
    lowerEntry.includes(indicator.toLowerCase())
  );
}

/**
 * Forbidden phrases that violate MMA safety rules
 */
const FORBIDDEN_PHRASES = [
  // Advisor violations
  'you should', 'try to', 'i encourage', 'have you considered',
  'the best thing', 'i suggest', 'you need to', 'you must',
  'maybe you could', 'why not try', 'you could try',
  // Identity violations
  'you are someone who', 'you\'ve always been', 'this is who you are',
  'you\'re the type', 'you\'re a person who',
  // Authority violations
  'i know that', 'trust me', 'i promise', 'things will get better',
  'it will be okay', 'everything will',
  // Third-party mind-reading violations
  'they probably', 'they must be', 'they\'re definitely',
  'they clearly', 'they obviously', 'they\'re just',
  // Toxic positivity
  'look on the bright side', 'at least', 'you\'ve got this',
  'you can do it', 'stay positive', 'cheer up'
];

/**
 * Validation result for MMA response
 */
interface MMAValidationResult {
  isValid: boolean;
  warnings: string[];
  violations: string[];
}

/**
 * Validate MMA response for safety rule violations
 * Used for logging/monitoring, not blocking
 */
function validateMMAResponse(response: string): MMAValidationResult {
  const lower = response.toLowerCase();
  const violations: string[] = [];
  
  FORBIDDEN_PHRASES.forEach(phrase => {
    if (lower.includes(phrase)) {
      violations.push(`Contains forbidden phrase: "${phrase}"`);
    }
  });
  
  return {
    isValid: violations.length === 0,
    warnings: [],
    violations
  };
}

// Rough token estimation (4 chars ≈ 1 token for English text)
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// Calculate days between two dates
function daysBetween(date1: string, date2: Date = new Date()): number {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  const diffTime = Math.abs(d2.getTime() - d1.getTime());
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}


// Embedding cache for performance (in-memory cache of embeddings)
// Key: entry text (normalized), Value: embedding vector
const embeddingCache = new Map<string, number[]>();

// Generate embedding for text using Gemini API
async function generateEmbedding(text: string): Promise<number[]> {
  // Normalize text for cache key
  const cacheKey = text.trim().toLowerCase();

  // Check cache first
  if (embeddingCache.has(cacheKey)) {
    return embeddingCache.get(cacheKey)!;
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    log.warn('No API key available, falling back to keyword similarity');
    throw new Error('API key required for embeddings');
  }

  try {
    const ai = new GoogleGenAI({ apiKey });

    // Use Gemini embedding model (text-embedding-004)
    // The API uses 'contents' (plural) and returns 'embeddings' (plural)
    const result = await ai.models.embedContent({
      model: 'text-embedding-004',
      contents: [{ text: text.trim() }],
    });

    // Extract embedding from result (first embedding from the array)
    const embedding = result.embeddings?.[0]?.values;

    if (!embedding) {
      throw new Error('No embedding returned from API');
    }

    // Cache the embedding
    embeddingCache.set(cacheKey, embedding);

    // Limit cache size to prevent memory issues (keep last 100 embeddings)
    if (embeddingCache.size > 100) {
      const firstKey = embeddingCache.keys().next().value;
      if (firstKey) {
        embeddingCache.delete(firstKey);
      }
    }

    return embedding;
  } catch (error) {
    log.error('Error generating embedding', {}, error as Error);
    throw error;
  }
}

// Calculate cosine similarity between two embedding vectors
function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) {
    throw new Error('Embedding vectors must have the same length');
  }

  // Dot product
  let dotProduct = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
  }

  // Calculate norms
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);

  // Cosine similarity (0-1, where 1 = identical meaning)
  if (normA === 0 || normB === 0) {
    return 0;
  }
  return dotProduct / (normA * normB);
}

// Calculate mood similarity score using emotion metadata
function calculateMoodSimilarity(currentMood: Mood, entryMood: Mood): number {
  // Exact match
  if (currentMood === entryMood) return 1.0;

  // Mood similarity groups (emotionally related moods)
  const moodGroups: Record<Mood, Mood[]> = {
    'calm': ['reflective', 'none'],
    'joyful': ['reflective'],
    'anxious': ['tired', 'heavy'],
    'tired': ['anxious', 'heavy', 'none'],
    'reflective': ['calm', 'joyful', 'none'],
    'heavy': ['anxious', 'tired'],
    'none': ['calm', 'reflective', 'tired']
  };

  // Check if moods are in the same emotional group
  const currentGroup = moodGroups[currentMood] || [];
  if (currentGroup.includes(entryMood)) {
    return 0.6; // Related mood
  }

  // Opposite moods (less relevant)
  const oppositePairs: [Mood, Mood][] = [
    ['joyful', 'heavy'],
    ['joyful', 'anxious'],
    ['calm', 'anxious'],
    ['calm', 'heavy']
  ];

  for (const [mood1, mood2] of oppositePairs) {
    if ((currentMood === mood1 && entryMood === mood2) ||
      (currentMood === mood2 && entryMood === mood1)) {
      return 0.2; // Opposite mood
    }
  }

  // Neutral similarity
  return 0.4;
}

// Calculate relevance score using single vector + emotion metadata
function calculateRelevanceScore(
  currentEmbedding: number[] | null,
  entryEmbedding: number[] | null,
  currentMood: Mood,
  entryMood: Mood
): { score: number; reasons: string[] } {
  // Semantic similarity from single vector
  let semanticScore = 0.5; // Default neutral score
  if (currentEmbedding && entryEmbedding) {
    try {
      semanticScore = cosineSimilarity(currentEmbedding, entryEmbedding);
    } catch (error) {
      log.warn('Error calculating semantic similarity', {}, error as Error);
    }
  }

  // Mood similarity from emotion metadata
  const moodScore = calculateMoodSimilarity(currentMood, entryMood);

  // Weighted combination: semantic (75%) + mood (25%)
  const finalScore = (
    semanticScore * SEMANTIC_WEIGHT +
    moodScore * MOOD_WEIGHT
  );

  // Build reasons array
  const reasons: string[] = [];

  if (semanticScore >= 0.7) {
    reasons.push('very similar content');
  } else if (semanticScore >= 0.5) {
    reasons.push('similar content');
  } else if (semanticScore >= 0.3) {
    reasons.push('somewhat similar content');
  }

  if (moodScore >= 0.8) {
    reasons.push('same mood');
  } else if (moodScore >= 0.6) {
    reasons.push('related mood');
  }

  if (reasons.length === 0 && finalScore >= 0.4) {
    reasons.push('semantically relevant');
  }

  return { score: finalScore, reasons };
}

// Lightweight re-ranking: boost recent entries and entries with topic matches
function reRankEntries(
  scoredEntries: Array<{ entry: HistoryEntry; score: number; relevanceReasons?: string[] }>,
  currentTopic: string | undefined
): Array<{ entry: HistoryEntry; score: number; relevanceReasons?: string[] }> {
  const now = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  return scoredEntries.map(scored => {
    let adjustedScore = scored.score;

    // Recency boost: entries from last 7 days get a small boost
    const entryDate = new Date(scored.entry.timestamp);
    entryDate.setHours(0, 0, 0, 0);
    const daysAgo = Math.ceil((now.getTime() - entryDate.getTime()) / (1000 * 60 * 60 * 24));

    if (daysAgo <= 7) {
      // Boost decreases with age: 7 days = +0.05, 0 days = +0.15
      const recencyBoost = 0.15 - (daysAgo / 7) * 0.10;
      adjustedScore = Math.min(1.0, scored.score + recencyBoost);
    }

    // Topic match boost: if topics match, add small boost
    if (currentTopic && scored.entry.topic) {
      const currentTopicLower = currentTopic.toLowerCase().trim();
      const entryTopicLower = scored.entry.topic.toLowerCase().trim();

      if (currentTopicLower === entryTopicLower) {
        adjustedScore = Math.min(1.0, adjustedScore + 0.1); // Exact topic match
      } else if (currentTopicLower.includes(entryTopicLower) || entryTopicLower.includes(currentTopicLower)) {
        adjustedScore = Math.min(1.0, adjustedScore + 0.05); // Partial topic match
      }
    }

    return {
      entry: scored.entry,
      score: adjustedScore,
      relevanceReasons: scored.relevanceReasons
    };
  });
}

// Format entry for context (uses summary for older entries to save tokens)
// Now includes memory confidence labels for MMA architecture
function formatEntryForContext(
  entry: HistoryEntry,
  includeReflection: boolean = false,
  relevanceScore?: number,
  relevanceReasons?: string[],
  confidenceLabel?: string
): string {
  const daysAgo = daysBetween(entry.timestamp);
  // Don't include specific dates in the context to prevent timestamp hallucinations
  // Use relative time indicators instead
  const timeIndicator = daysAgo <= 1 ? 'Recent' : daysAgo <= 7 ? 'This week' : 'Earlier';

  let entryText: string;

  if (daysAgo <= DAYS_RECENT) {
    // Recent entries: use full text
    entryText = entry.text;
  } else if (daysAgo <= DAYS_MEDIUM && entry.summary) {
    // Medium entries: use summary
    entryText = `[Summary] ${entry.summary}`;
  } else if (entry.summary) {
    // Old entries: use summary only
    entryText = `[Summary] ${entry.summary}`;
  } else {
    // Fallback: truncate old entries
    entryText = entry.text.length > 200 ? entry.text.substring(0, 200) + '...' : entry.text;
  }

  // Include topic in context if available
  const topicStr = entry.topic ? ` | Topic: ${entry.topic}` : '';

  // Add memory confidence label (MMA architecture)
  const memoryLabel = confidenceLabel || '';

  // Add relevance label with reasons why this entry is relevant
  let relevanceLabel = '';
  if (relevanceReasons && relevanceReasons.length > 0) {
    const reasonsStr = relevanceReasons.join(', ');
    relevanceLabel = ` [Relevant: ${reasonsStr}]`;
  }

  let context = `[${timeIndicator} | ${entry.mood}${topicStr}]${relevanceLabel}\n${memoryLabel}\n${entryText}`;

  if (includeReflection && daysAgo <= DAYS_RECENT) {
    // Only include full reflection for recent entries
    context += `\nReflection: ${entry.reflection}`;
  } else if (includeReflection && entry.summary) {
    // For older entries, just mention there was a reflection
    context += `\n[Previous reflection available]`;
  }

  return context;
}

// Select and format relevant context entries
// Updated for MMA architecture with memory confidence scoring
interface ContextEntry {
  entry: HistoryEntry;
  score: number;
  tokens: number;
  relevanceReasons?: string[];
  confidenceLabel?: string;
}

async function selectRelevantContext(
  currentEntry: string,
  currentMood: Mood,
  currentTopic: string | undefined,
  history: HistoryEntry[],
  maxTokens: number,
  includeReflection: boolean = false
): Promise<string> {
  if (history.length === 0) {
    return "No previous history available.";
  }

  // STEP 1: Generate single embedding for current entry
  let currentEmbedding: number[] | null = null;
  try {
    currentEmbedding = await generateEmbedding(currentEntry);
    log.debug('Generated single embedding for current entry');
  } catch (error) {
    log.warn('Failed to generate embedding for current entry', {}, error as Error);
  }

  // STEP 2: Generate single embeddings for history entries in parallel
  const embeddingPromises = history.map(async (entry) => {
    try {
      return await generateEmbedding(entry.text);
    } catch (error) {
      log.warn('Failed to generate embedding for entry', { entryId: entry.id });
      return null;
    }
  });

  const historyEmbeddings = await Promise.all(embeddingPromises);
  const successfulCount = historyEmbeddings.filter(e => e !== null).length;
  log.debug('Generated embeddings for history entries', {
    successful: successfulCount,
    total: history.length
  });

  // STEP 3: Calculate initial relevance scores (single vector + emotion metadata)
  const scoredEntries = history.map((entry, index) => {
    const { score, reasons } = calculateRelevanceScore(
      currentEmbedding,
      historyEmbeddings[index],
      currentMood,
      entry.mood || 'none'
    );
    return {
      entry,
      score,
      relevanceReasons: reasons.length > 0 ? reasons : undefined,
      tokens: 0 // Will calculate after formatting
    };
  });

  // STEP 4: Filter by minimum relevance threshold
  let filteredEntries = scoredEntries.filter(scored => {
    return scored.score >= MIN_RELEVANCE_SCORE;
  });

  if (filteredEntries.length === 0) {
    // If no entries meet threshold, use the highest scoring one
    const highestScoring = scoredEntries.sort((a, b) => b.score - a.score)[0];
    if (highestScoring) {
      filteredEntries.push(highestScoring);
    }
  }

  // STEP 5: Lightweight re-ranking (post-filter)
  // Sort by score, take top K, then re-rank with recency and topic boosts
  filteredEntries.sort((a, b) => b.score - a.score);
  const topKEntries = filteredEntries.slice(0, RE_RANK_TOP_K);
  const reRankedEntries = reRankEntries(topKEntries, currentTopic);

  // Re-sort after re-ranking
  reRankedEntries.sort((a, b) => b.score - a.score);

  // STEP 6: Apply MMA Memory Confidence Scoring
  // Calculate confidence for each entry and filter out low-confidence items
  const entriesWithConfidence: ContextEntry[] = reRankedEntries.map(scored => {
    const confidenceResult = calculateEntryConfidence(
      scored.entry,
      scored.score, // Use relevance score as semantic similarity
      history
    );
    
    return {
      ...scored,
      confidenceLabel: confidenceResult.confidence.shouldSurface 
        ? formatConfidenceLabel(confidenceResult.confidence)
        : undefined,
      // Don't include entries that fail confidence threshold
      tokens: confidenceResult.confidence.shouldSurface ? 0 : -1
    };
  }).filter(entry => entry.tokens !== -1); // Remove excluded entries

  log.debug('Applied memory confidence scoring', {
    before: reRankedEntries.length,
    after: entriesWithConfidence.length,
    excluded: reRankedEntries.length - entriesWithConfidence.length
  });

  // STEP 7: Calculate tokens and select entries within limit
  const entriesWithTokens = entriesWithConfidence.map(scored => ({
    ...scored,
    tokens: estimateTokens(
      formatEntryForContext(
        scored.entry, 
        includeReflection, 
        scored.score, 
        scored.relevanceReasons,
        scored.confidenceLabel
      )
    )
  }));

  const selected: ContextEntry[] = [];
  let totalTokens = 0;

  for (const scored of entriesWithTokens) {
    // Check if we have room
    if (totalTokens + scored.tokens > maxTokens) {
      // Try to fit a shorter version (summary only)
      if (scored.entry.summary && !formatEntryForContext(scored.entry, includeReflection).includes('[Summary]')) {
        const summaryText = formatEntryForContext(
          scored.entry,
          false, // Don't include reflection in summary version
          scored.score,
          scored.relevanceReasons,
          scored.confidenceLabel
        ).replace(scored.entry.text, `[Summary] ${scored.entry.summary}`);
        const summaryTokens = estimateTokens(summaryText);

        if (totalTokens + summaryTokens <= maxTokens) {
          const summaryVersion: ContextEntry = {
            ...scored,
            tokens: summaryTokens
          };
          selected.push(summaryVersion);
          totalTokens += summaryTokens;
        }
      }
      continue;
    }

    selected.push(scored);
    totalTokens += scored.tokens;
  }

  // Log context selection for debugging
  log.debug('Selected context entries', {
    selected: selected.length,
    total: history.length,
    tokens: totalTokens
  });
  selected.forEach((scored, idx) => {
    log.debug(`Context entry ${idx + 1}`, {
      score: `${(scored.score * 100).toFixed(0)}%`,
      confidence: scored.confidenceLabel || 'none',
      reasons: scored.relevanceReasons?.join(', ') || 'none',
      entryId: scored.entry.id
    });
  });

  // Sort selected entries by date (most recent last, to show progression)
  selected.sort((a, b) => {
    const dateA = new Date(a.entry.timestamp).getTime();
    const dateB = new Date(b.entry.timestamp).getTime();
    return dateA - dateB;
  });

  // Format the context with labels and confidence
  const contextParts = selected.map(scored =>
    formatEntryForContext(
      scored.entry, 
      includeReflection, 
      scored.score, 
      scored.relevanceReasons,
      scored.confidenceLabel
    )
  );
  return contextParts.join('\n\n---\n\n');
}

// Access environment variable - Next.js will replace this at build time
// for NEXT_PUBLIC_ variables
declare const process: {
  env: {
    NEXT_PUBLIC_GEMINI_API_KEY?: string;
    GEMINI_API_KEY?: string;
  };
};

const getApiKey = (): string => {
  // Next.js embeds NEXT_PUBLIC_ environment variables at build time
  // They're available in both client and server code
  return process.env.NEXT_PUBLIC_GEMINI_API_KEY || process.env.GEMINI_API_KEY || '';
};

export const detectMood = async (entry: string): Promise<Mood> => {
  const entryLength = entry.trim().length;
  log.debug('Mood detection called', { entryLength });

  if (!entry.trim() || entryLength < 15) {
    log.debug('Entry too short for mood detection, defaulting to none', { entryLength });
    return 'none'; // Need minimum text to detect mood
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    log.warn('No API key available for mood detection, defaulting to none');
    return 'none'; // Fail silently if no API key
  }

  log.debug('Starting mood detection');
  const ai = new GoogleGenAI({ apiKey });

  const moodDetectionPrompt = `Analyze this journal entry and identify the emotional mood or state.

Available moods:
- "calm" - peaceful, relaxed, serene
- "joyful" - happy, excited, positive, grateful
- "anxious" - worried, nervous, stressed, overwhelmed
- "tired" - exhausted, drained, fatigued
- "reflective" - thoughtful, contemplative, introspective
- "heavy" - sad, burdened, melancholic, down
- "none" - neutral, unclear, or mixed emotions

Guidelines:
- Return ONE mood that best represents the overall emotional tone
- Focus on the dominant emotional state
- If truly neutral or unclear, return "none"
- Be sensitive to emotional nuances

Journal entry:
"${entry.trim()}"

Identify the mood:`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: moodDetectionPrompt,
      config: {
        temperature: 0.5, // Lower temperature for more consistent mood detection
        maxOutputTokens: 20,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            mood: {
              type: Type.STRING,
              description: "The emotional mood: calm, joyful, anxious, tired, reflective, heavy, or none"
            },
            confidence: {
              type: Type.STRING,
              description: "high, medium, or low - how clear the mood is"
            }
          },
          required: ["mood"]
        }
      },
    });

    let detectedMood: Mood = 'none';
    const responseText = response.text || '';
    log.debug('Mood detection API response', { responseLength: responseText.length, preview: responseText.substring(0, 100) });

    try {
      const moodData = JSON.parse(responseText);
      const rawMood = (moodData.mood || '').toLowerCase().trim();
      const confidence = moodData.confidence || 'medium';

      log.debug('Parsed mood data', { rawMood, confidence, moodData });

      // Validate mood is one of the allowed values
      const validMoods: Mood[] = ['calm', 'joyful', 'anxious', 'tired', 'reflective', 'heavy', 'none'];
      if (validMoods.includes(rawMood as Mood)) {
        detectedMood = rawMood as Mood;
        log.info('Mood detected successfully', { mood: detectedMood, confidence });
      } else {
        log.warn('Invalid mood detected, defaulting to none', { detectedMood: rawMood, validMoods });
      }
    } catch (parseError) {
      log.warn('JSON parse failed, trying text extraction', { error: parseError, responseText: responseText.substring(0, 200) });
      // Fallback: try to extract mood from text response
      const textResponse = responseText.toLowerCase().trim();
      const validMoods: Mood[] = ['calm', 'joyful', 'anxious', 'tired', 'reflective', 'heavy'];
      for (const mood of validMoods) {
        if (textResponse.includes(mood)) {
          detectedMood = mood;
          log.info('Extracted mood from text response', { mood: detectedMood });
          break;
        }
      }
      if (detectedMood === 'none') {
        log.warn('Could not parse mood from response', { response: textResponse.substring(0, 200) });
      }
    }

    return detectedMood;
  } catch (error) {
    log.error('Mood detection error', {}, error as Error);
    return 'none'; // Fail silently, default to 'none'
  }
};

export const getJournalReflection = async (
  entry: string,
  mood: string,
  history: HistoryEntry[]
): Promise<{ 
  reflection: string; 
  summary: string; 
  topic?: string; 
  mood?: Mood; 
  entities?: ExtractedEntities; 
  highlights?: Highlight[];
  mma?: MMAReflection;
}> => {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured. Please set NEXT_PUBLIC_GEMINI_API_KEY in your .env.local file');
  }
  const ai = new GoogleGenAI({ apiKey });

  // Step 1: Extract entities from current entry (parallel with mood/topic detection)
  let currentEntities: ExtractedEntities | undefined;
  try {
    log.debug('Extracting entities from current entry');
    currentEntities = await extractEntities(entry);
    log.info('Entities extracted', { 
      people: currentEntities.people.length,
      places: currentEntities.places.length,
      events: currentEntities.events.length,
      organizations: currentEntities.organizations.length
    });
  } catch (error) {
    log.error('Entity extraction failed', {}, error as Error);
    // Continue without entities - don't break the flow
  }

  // Step 2: Always auto-detect mood (ignore user-selected mood, use AI detection)
  let finalMood: Mood = 'none';
  try {
    log.debug('Auto-detecting mood for entry', { entryLength: entry.length });
    const detectedMood = await detectMood(entry);
    if (detectedMood && detectedMood !== 'none') {
      finalMood = detectedMood;
      log.info('Mood detected for reflection', { mood: finalMood });
    } else {
      log.debug('No mood detected, using none', { detectedMood });
      finalMood = 'none';
    }
  } catch (moodError) {
    log.error('Mood detection error during reflection', {}, moodError as Error);
    // Fallback to 'none' if detection fails
    finalMood = 'none';
  }

  // Step 3: Detect topic FIRST so we can use it for better context selection
  let detectedTopic: string | undefined;
  try {
    log.debug('Detecting topic for entry');
    detectedTopic = await detectTopic(entry);
    if (detectedTopic) {
      log.info('Topic detected for reflection', { topic: detectedTopic });
    } else {
      log.debug('No topic detected (entry may be too short or topic unclear)');
    }
  } catch (topicError) {
    log.error('Topic detection error during reflection', {}, topicError as Error);
    // Continue without topic if detection fails
  }

  // Step 4: Build entity context from history (last 3 entries)
  const entityContext = buildEntityContext(history, 3);
  const entityContextPrompt = formatEntityContextForPrompt(entityContext);

  // Step 5: Use improved context selection with topic and confidence scoring
  const historyContext = await selectRelevantContext(
    entry,
    finalMood,
    detectedTopic,
    history,
    MAX_CONTEXT_TOKENS_REFLECTION,
    true // Include reflections for reflection generation
  );

  // Step 6: Detect third-party content for safety rules
  const hasThirdPartyContent = detectThirdPartyContent(entry);
  const thirdPartySafetyPrompt = hasThirdPartyContent ? `
**⚠️ THIRD-PARTY SAFETY ACTIVE**
This entry involves other people. You MUST:
- Name ambiguity about their intentions ("It's unclear what they meant...")
- Reflect the USER's feelings only ("This left you feeling...")
- Separate feelings from facts ("You felt dismissed, though their intent is unknown")
- NEVER validate suspicions, mind-read others, or take sides
` : '';

  // Step 7: Build MMA prompt
  const prompt = `
### ENTITY CONTEXT (SPECIFIC DETAILS FROM RECENT ENTRIES)
${entityContextPrompt}

### USER CONTEXT (RELEVANT PAST ENTRIES)
Each entry below includes a MEMORY CONFIDENCE LABEL. Use the appropriate recall language:
- HIGH CONFIDENCE → "You mentioned...", "You wrote about..."
- MEDIUM CONFIDENCE → "It seems like...", "There may be..."
- LOW CONFIDENCE → "This might connect to...", "This could relate to..."

${historyContext}

### CURRENT ENTRY
"${entry}"
${thirdPartySafetyPrompt}

---

## YOUR TASK

Generate a reflection following the MMA structure (Mirror → Meaning → Anchor).

**MIRROR** — What is happening?
- Reflect emotions and tensions WITHOUT advice or conclusions
- Vary your openings: "It sounds like...", "There's a sense of...", "What comes through is...", "There's something here about..."

**MEANING** — What does this feeling signal?
- Explain WHY this feeling might exist (orientation, not solutions)
- Use: "This kind of feeling often shows up when...", "It can signal that...", "This reaction makes sense because..."

**ANCHOR** — Ground emotionally WITH PRESENCE (2-3 sentences)
- Make the user feel accompanied, not alone with insight
- Must contain FELT CARE, not just logical statements
- Answer the implicit question: "Am I okay to be here like this?"
- Vary your language: "It makes sense that this feels heavy...", "You don't have to push yourself to feel different...", "There's no rush to move past this...", "You don't have to have this figured out..."
- AVOID cold/clinical: "This feeling is allowed to exist" (too distant)

**CRITICAL RULES:**
- ❌ NO advice ("You should...", "Try to...", "Have you considered...")
- ❌ NO authority ("I know that...", "Trust me...", "Things will get better...")
- ❌ NO identity claims ("You are someone who...", "You've always been...")
- ❌ NO timestamps unless USER mentioned time
- ❌ NO mind-reading others ("They probably...", "They must be...")
- ✅ Be LESS certain than the user
- ✅ Use names/places from entity context with appropriate confidence language

**Also identify:**
1. **Topic** (1-3 words) - the primary subject matter
2. **Mood** - calm, joyful, anxious, tired, reflective, heavy, or none
3. **Highlights** - phrases from YOUR response (2-5 words each):
   - **main_idea**: Core insight (1-2 max)
   - **somatic_stressor**: Physical sensations OR external pressures
   - **moment_of_agency**: Actions taken, voice used (NOT celebratory, just noticing)
`;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        temperature: 0.7,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            mirror: {
              type: Type.STRING,
              description: "MIRROR section: Reflect emotions and tensions without advice, encouragement, or conclusions. Use 'It sounds like...', 'There's a sense of...'"
            },
            meaning: {
              type: Type.STRING,
              description: "MEANING section: Explain what this feeling signals - give orientation, not solutions. Use 'This kind of feeling often shows up when...', 'It can signal that...'"
            },
            anchor: {
              type: Type.STRING,
              description: "ANCHOR section: 2-3 sentences of emotional grounding WITH FELT PRESENCE. Must make user feel accompanied, not alone with insight. VARY your language — use warm phrases like 'It makes sense that this feels heavy...', 'You don't have to push yourself to feel different...', 'There's no rush to move past this...'. AVOID cold/clinical statements. NO promises, NO toxic positivity, NO advice."
            },
            summary: { 
              type: Type.STRING, 
              description: "A one-sentence summary of the entry's core theme." 
            },
            topic: {
              type: Type.STRING,
              description: "The main topic (1-3 words) - what is the primary subject matter? Focus on WHAT they're writing about, not emotional state."
            },
            mood: {
              type: Type.STRING,
              description: "The emotional mood: calm, joyful, anxious, tired, reflective, heavy, or none."
            },
            highlights: {
              type: Type.ARRAY,
              description: "Key phrases from YOUR reflection to highlight (2-5 words each)",
              items: {
                type: Type.OBJECT,
                properties: {
                  text: {
                    type: Type.STRING,
                    description: "The exact phrase to highlight (must appear in your mirror/meaning/anchor sections)"
                  },
                  type: {
                    type: Type.STRING,
                    description: "Category: main_idea (core insight, 1-2 max), somatic_stressor (physical sensations OR external pressures), or moment_of_agency (actions/voice, NOT celebratory)"
                  }
                },
                required: ["text", "type"]
              }
            }
          },
          required: ["mirror", "meaning", "anchor", "summary", "topic", "mood"]
        }
      },
    });

    const data = JSON.parse(response.text || "{}");
    
    // Extract MMA sections
    const mirror = data.mirror || "";
    const meaning = data.meaning || "";
    const anchor = data.anchor || "";
    
    // Combine MMA sections into full reflection with visual structure
    const reflectionContent = [mirror, meaning, anchor].filter(Boolean).join('\n\n');
    
    const summaryContent = data.summary || "A moment of reflection.";
    
    // Normalize highlight types (identity_win → moment_of_agency)
    const highlights: Highlight[] = Array.isArray(data.highlights) 
      ? data.highlights.map((h: any) => ({
          text: h.text,
          type: h.type === 'identity_win' ? 'moment_of_agency' : h.type
        }))
      : [];
    
    log.info('AI returned MMA response', { 
      mirrorLength: mirror.length,
      meaningLength: meaning.length,
      anchorLength: anchor.length,
      highlights: highlights.length 
    });

    // Validate MMA response for safety rule violations (logging only)
    const validation = validateMMAResponse(reflectionContent);
    if (!validation.isValid) {
      log.warn('MMA validation violations detected', { 
        violations: validation.violations,
        count: validation.violations.length
      });
    }

    // Process mood from response
    let reflectionMood: Mood | undefined;
    if (data.mood) {
      const rawMood = (data.mood || '').toLowerCase().trim();
      const validMoods: Mood[] = ['calm', 'joyful', 'anxious', 'tired', 'reflective', 'heavy', 'none'];
      if (validMoods.includes(rawMood as Mood)) {
        reflectionMood = rawMood as Mood;
        log.info('Mood from reflection response', { mood: reflectionMood });
      }
    }

    // Use mood from reflection if available
    if (reflectionMood && reflectionMood !== 'none') {
      finalMood = reflectionMood;
    } else if (reflectionMood === 'none') {
      finalMood = 'none';
    }

    // Process topic from response
    let finalTopic: string | undefined = data.topic;
    if (finalTopic) {
      finalTopic = finalTopic
        .trim()
        .replace(/^["']|["']$/g, '')
        .split(/[,;.\n]/)[0]
        .split(/\s+/)
        .slice(0, 3)
        .join(' ')
        .trim();

      if (finalTopic) {
        finalTopic = finalTopic
          .toLowerCase()
          .split(/\s+/)
          .map(word => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' ');
      }
    }

    // Fallback to detected topic
    if (!finalTopic || finalTopic.toLowerCase() === 'general' || finalTopic.toLowerCase() === 'none') {
      finalTopic = detectedTopic;
    }

    return {
      reflection: reflectionContent,
      summary: summaryContent,
      topic: finalTopic,
      mood: finalMood,
      entities: currentEntities,
      highlights: highlights,
      mma: {
        mirror,
        meaning,
        anchor
      }
    };
  } catch (error) {
    log.error('Gemini API error during reflection generation', {}, error as Error);
    throw error;
  }
};

export const startJournalChat = async (
  entry: string,
  initialReflection: string,
  mood: string,
  history: HistoryEntry[],
  currentTopic?: string
): Promise<Chat> => {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured. Please set NEXT_PUBLIC_GEMINI_API_KEY in your .env.local file');
  }
  const ai = new GoogleGenAI({ apiKey });

  // Build entity context for chat (last 3 entries)
  const entityContext = buildEntityContext(history, 3);
  const entityContextPrompt = formatEntityContextForPrompt(entityContext);

  // Use improved context selection for chat with confidence scoring
  const historyContext = await selectRelevantContext(
    entry,
    mood as Mood,
    currentTopic,
    history,
    MAX_CONTEXT_TOKENS_CHAT,
    false // Don't include full reflections in chat context to save tokens
  );

  // Detect third-party content for safety
  const hasThirdPartyContent = detectThirdPartyContent(entry);

  // Chat-specific MMA system instruction
  const chatSystemInstruction = `
You are "Serenity," a journaling reflection AI in CHAT MODE.

## CORE PHILOSOPHY (NON-NEGOTIABLE)
You do NOT solve the user's life. You help them orient themselves.
- No instructions or advice
- No authority over truth
- Be LESS certain than the user

## CHAT MODE RULES
In follow-up conversations, maintain the MMA principles:
- MIRROR feelings without resolving them
- Provide MEANING (why feelings exist) without solutions
- ANCHOR emotionally WITH PRESENCE — make user feel accompanied, not alone

**CRITICAL:** Your responses must have emotional warmth, not clinical distance.
The user should feel "I'm not alone" — not "I've been analyzed."

## SAFETY RULES
${hasThirdPartyContent ? `
**⚠️ THIRD-PARTY SAFETY ACTIVE**
- Name ambiguity about others' intentions
- Reflect USER's feelings only
- Separate feelings from facts
- NEVER validate suspicions or mind-read others
` : ''}

**Forbidden:**
- ❌ "You should...", "Try to...", "Have you considered..."
- ❌ "I know that...", "Trust me...", "Things will get better..."
- ❌ "You are someone who...", "You've always been..."
- ❌ Timestamps unless user mentioned time
- ❌ Mind-reading others ("They probably...", "They must be...")

**Allowed:**
- ✅ "This doesn't mean...", "It's okay that..."
- ✅ "This kind of feeling often shows up when..."
- ✅ Reference entities by name with appropriate confidence language

## CONTEXT

**Entity Context:**
${entityContextPrompt}

**Journal Entry:** ${entry}
**Mood:** ${mood}
**Your Initial Reflection:** ${initialReflection}

**Relevant Past Context (with memory confidence labels):**
${historyContext}

**Memory Recall Rules:**
- HIGH CONFIDENCE → "You mentioned...", "You wrote about..."
- MEDIUM CONFIDENCE → "It seems like...", "There may be..."
- LOW CONFIDENCE → "This might connect to...", "This could relate to..."

Focus on the current conversation. Use entity context to be specific. Only reference past entries when directly relevant.`;

  return ai.chats.create({
    model: 'gemini-3-flash-preview',
    config: {
      systemInstruction: chatSystemInstruction,
      temperature: 0.7,
    },
  });
};

function cleanTextForTTS(text: string): string {
  return text
    .replace(/[#*`_~]/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/- /g, '')
    .replace(/\n+/g, ' ')
    .trim();
}

export const detectTopic = async (entry: string): Promise<string | undefined> => {
  const entryLength = entry.trim().length;
  log.debug('Topic detection called', { entryLength });

  if (!entry.trim() || entryLength < 15) {
    log.debug('Entry too short for topic detection', { entryLength });
    return undefined; // Need minimum text to detect topic
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    log.warn('No API key available for topic detection');
    return undefined; // Fail silently if no API key
  }

  log.debug('Starting topic detection');
  const ai = new GoogleGenAI({ apiKey });

  // Improved prompt with better examples and clearer instructions
  // Use structured output for more reliable results
  const topicDetectionPrompt = `Analyze this journal entry and identify the main topic or theme.

Focus on WHAT the person is writing about (the subject matter), not their emotional state or mood.

Examples of good topics:
- "work deadlines", "work stress", "work relationships"
- "family conflict", "family time", "family planning"
- "health anxiety", "fitness goals", "medical concerns"
- "relationship struggles", "dating", "friendship"
- "career planning", "job search", "career growth"
- "academic pressure", "studying", "school challenges"
- "financial worries", "budgeting", "financial goals"
- "self-reflection", "personal growth", "self-improvement"
- "travel planning", "vacation", "exploration"
- "creative projects", "art", "writing"
- "hobbies", "interests", "passions"

Guidelines:
- Return 1-3 words maximum
- Be specific and descriptive
- Focus on the dominant subject if multiple topics exist
- Avoid vague words like "feelings", "thoughts", "life", "day"
- If the entry is too vague or generic, return "general"

Journal entry:
"${entry.trim()}"

Identify the main topic:`;

  try {
    // Use structured output for more reliable topic detection
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: topicDetectionPrompt,
      config: {
        temperature: 0.5, // Balanced for understanding and consistency
        maxOutputTokens: 30, // Allow for descriptive topics
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            topic: {
              type: Type.STRING,
              description: "The main topic or theme (1-3 words)"
            },
            confidence: {
              type: Type.STRING,
              description: "high, medium, or low - how clear the topic is"
            }
          },
          required: ["topic"]
        }
      },
    });

    // Parse JSON response
    let detectedTopic: string | undefined;
    try {
      const topicData = JSON.parse(response.text || '{}');
      detectedTopic = topicData.topic || response.text || '';
      const confidence = topicData.confidence || 'medium';
      log.info('Topic detected', { topic: detectedTopic, confidence });
    } catch (parseError) {
      // Fallback to text parsing if JSON parsing fails
      detectedTopic = (response.text || '').trim();
      log.warn('JSON parse failed, using text response', { detectedTopic });
    }

    if (!detectedTopic) {
      log.debug('No topic detected in response');
      return undefined;
    }

    // Clean up the response - remove quotes, take first few words
    const cleanedTopic = detectedTopic
      .replace(/^["']|["']$/g, '') // Remove surrounding quotes
      .replace(/^topic\s*[:\-]\s*/i, '') // Remove "topic:" prefix if present
      .split(/[,;.\n]/)[0] // Take first phrase if multiple
      .split(/\s+/)
      .slice(0, 3) // Take max 3 words
      .join(' ')
      .trim()
      .toLowerCase();

    // Return undefined if empty or too generic
    if (!cleanedTopic || cleanedTopic === 'none' || cleanedTopic === 'general') {
      log.debug('Topic filtered out (generic/empty)', { cleanedTopic });
      return undefined;
    }

    // Capitalize first letter of each word for better formatting
    const finalTopic = cleanedTopic
      .split(/\s+/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
    log.debug('Topic cleaned', { raw: detectedTopic, cleaned: finalTopic });
    return finalTopic;
  } catch (error) {
    log.error('Topic detection error', {}, error as Error);
    return undefined; // Fail silently
  }
};

// Request deduplication map
const pendingTTSRequests = new Map<string, Promise<string | undefined>>();

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

// Generate speech using server-side API (prevents rate limit issues)
async function generateSpeechChunk(
  text: string,
  retries: number = 3,
  delay: number = 1000
): Promise<string | undefined> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text }),
      });

      if (response.status === 429) {
        // Rate limit exceeded - get retry-after header
        const retryAfter = response.headers.get('Retry-After');
        const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : delay * Math.pow(2, attempt);

        const isLastAttempt = attempt === retries - 1;
        if (isLastAttempt) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.message || 'Rate limit exceeded. Please try again later.');
        }

        log.warn('Rate limit hit, waiting before retry', {
          attempt: attempt + 1,
          retries,
          waitTime
        });
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `TTS API error: ${response.status}`);
      }

      const data = await response.json();
      return data.audioData;
    } catch (error: any) {
      const isLastAttempt = attempt === retries - 1;
      if (isLastAttempt) {
        log.error(`TTS error after ${retries} attempts`, { attempt: attempt + 1, retries }, error as Error);
        throw error;
      }

      // Exponential backoff for non-rate-limit errors
      const waitTime = delay * Math.pow(2, attempt);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }

  return undefined;
}

// Main function with deduplication and chunking support
export const generateSpeech = async (
  text: string,
  options?: { useCache?: boolean; chunked?: boolean }
): Promise<string | string[] | undefined> => {
  const { useCache = true, chunked = false } = options || {};

  // ========================================
  // LAYER 1: Check IndexedDB Cache (Local, Instant)
  // ========================================
  if (useCache && typeof window !== 'undefined') {
    try {
      const { audioCache } = await import('../utils/audioCache');
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
      const request = generateSpeechChunk(chunks[0]);
      pendingTTSRequests.set(textHash, request);
      try {
        const result = await request;
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
        if (result) results.push(result);
        continue;
      }

      // Add delay before each chunk (except the first one)
      if (i > 0) {
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_CHUNKS_MS));
      }

      const request = generateSpeechChunk(chunk);
      pendingTTSRequests.set(chunkHash, request);

      try {
        const result = await request.finally(() => pendingTTSRequests.delete(chunkHash));
        if (result) results.push(result);
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
        const { audioCache } = await import('../utils/audioCache');
        // For chunked audio, we can store the first chunk for cache hit
        // (full playback will use all chunks, but cache hit detection uses first chunk)
        await audioCache.set(text, results[0]);
        log.debug('TTS: Saved chunked audio to IndexedDB cache', { 
          chunks: results.length,
          textLength: text.length 
        });
      } catch (error) {
        log.warn('Failed to save chunked audio to cache', {}, error as Error);
      }
    }

    return results.length > 0 ? results : undefined;
  }

  // Single generation (original behavior for backward compatibility)
  const request = generateSpeechChunk(text);
  pendingTTSRequests.set(textHash, request);

  try {
    const result = await request;
    pendingTTSRequests.delete(textHash);
    
    // Save to IndexedDB cache after successful generation
    if (result && useCache && typeof window !== 'undefined') {
      try {
        const { audioCache } = await import('../utils/audioCache');
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
