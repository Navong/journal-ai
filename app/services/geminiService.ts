
import { GoogleGenAI, Chat, Modality, Type } from "@google/genai";
import { HistoryEntry, ChatMessage, Mood } from "../types";

const SYSTEM_INSTRUCTION = `
You are "Serenity," a compassionate journaling companion. Your expertise lies in empathetic reflection and pattern recognition across a user's mental wellness journey.

ROLE & OBJECTIVES:
1. PRIMARY FOCUS: Reflect on the user's current journal entry with deep empathy and validation.
2. LONG-TERM MEMORY: You have access to a context window of the user's past entries. Use this history to identify recurring themes, progress, or shifts in mood over time.
3. PATTERN RECOGNITION: If the user mentions a struggle they've faced before, gently acknowledge their persistence or any new ways they are handling it.
4. NON-CLINICAL: Stay supportive and non-diagnostic. Use warm, human-centric language.
5. CHAT MODE: When the user asks follow-up questions, continue to be their companion. 

OUTPUT FORMAT:
You must provide your response in JSON format with two fields:
- "reflection": Your deep, empathetic response (Markdown allowed).
- "summary": A very brief, one-sentence summary of the user's core theme or emotion in this entry.
`;

// Context configuration constants
const MAX_CONTEXT_TOKENS_REFLECTION = 2500;
const MAX_CONTEXT_TOKENS_CHAT = 1500;
const DAYS_RECENT = 3; // Entries within this many days use full text
const DAYS_MEDIUM = 14; // Entries within this many days use summaries
const RECENCY_WEIGHT = 0.2;
const MOOD_WEIGHT = 0.3;
const TOPIC_WEIGHT = 0.4; // Highest weight - topics are very important for context
const SIMILARITY_WEIGHT = 0.1;
const MIN_RELEVANCE_SCORE = 0.35; // Minimum relevance score to include entry (filters out irrelevant entries)

// Dynamic weights for same-day entries (when multiple entries exist on the same day)
const SAME_DAY_RECENCY_WEIGHT = 0.1; // Reduced recency weight for same-day entries
const SAME_DAY_TOPIC_WEIGHT = 0.5; // Increased topic weight for same-day entries
const SAME_DAY_MOOD_WEIGHT = 0.25;
const SAME_DAY_SIMILARITY_WEIGHT = 0.15;

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

// Mood similarity scoring
function getMoodScore(currentMood: Mood, entryMood: Mood): number {
  if (currentMood === 'none' || entryMood === 'none') return 0.5; // Neutral if no mood selected

  if (currentMood === entryMood) return 1.0;

  // Mood groups with similar emotional states
  const moodGroups = [
    ['calm', 'reflective'],
    ['joyful', 'calm'],
    ['anxious', 'heavy'],
    ['tired', 'heavy'],
    ['reflective', 'calm'],
  ];

  // Check if moods are in same group
  for (const group of moodGroups) {
    if (group.includes(currentMood) && group.includes(entryMood)) {
      return 0.7;
    }
  }

  // Opposite moods (transitions are also interesting)
  const transitions: [Mood, Mood][] = [
    ['anxious', 'calm'],
    ['heavy', 'joyful'],
    ['tired', 'calm'],
  ];

  for (const [m1, m2] of transitions) {
    if ((currentMood === m1 && entryMood === m2) || (currentMood === m2 && entryMood === m1)) {
      return 0.6; // Transitions are valuable context
    }
  }

  return 0.3; // Unrelated moods
}

// Simple keyword/content similarity (basic implementation)
// For a production app, you'd use embeddings, but this works reasonably well
function getContentSimilarity(currentEntry: string, entryText: string): number {
  const currentWords = new Set(currentEntry.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  const entryWords = new Set(entryText.toLowerCase().split(/\s+/).filter(w => w.length > 3));

  if (currentWords.size === 0) return 0.5;

  const intersection = new Set([...currentWords].filter(x => entryWords.has(x)));
  return intersection.size / currentWords.size;
}

// Recency scoring (exponential decay - more recent = higher score)
function getRecencyScore(daysAgo: number): number {
  if (daysAgo <= 1) return 1.0;
  if (daysAgo <= 3) return 0.9;
  if (daysAgo <= 7) return 0.7;
  if (daysAgo <= 14) return 0.5;
  if (daysAgo <= 30) return 0.3;
  return 0.1;
}

// Topic similarity scoring
function getTopicScore(currentTopic: string | undefined, entryTopic: string | undefined): number {
  // If no topics, neutral score
  if (!currentTopic && !entryTopic) return 0.5;
  if (!currentTopic || !entryTopic) return 0.3; // Partial match is less relevant

  const current = currentTopic.toLowerCase().trim();
  const entry = entryTopic.toLowerCase().trim();

  // Exact match
  if (current === entry) return 1.0;

  // Check if one topic contains the other (e.g., "work stress" vs "work")
  if (current.includes(entry) || entry.includes(current)) {
    return 0.8; // Strong similarity
  }

  // Check for word overlap (e.g., "work relationships" vs "work life")
  const currentWords = new Set(current.split(/\s+/));
  const entryWords = new Set(entry.split(/\s+/));
  const intersection = new Set([...currentWords].filter(x => entryWords.has(x)));

  if (intersection.size > 0) {
    // Calculate overlap ratio
    const unionSize = new Set([...currentWords, ...entryWords]).size;
    return 0.5 + (intersection.size / unionSize) * 0.3; // Between 0.5 and 0.8
  }

  // No similarity
  return 0.2;
}

// Calculate relevance score and reasons for an entry
function calculateRelevanceScore(
  currentEntry: string,
  currentMood: Mood,
  currentTopic: string | undefined,
  historyEntry: HistoryEntry,
  isSameDay: boolean = false // Whether this entry is from the same day as current entry
): { score: number; reasons: string[] } {
  const daysAgo = daysBetween(historyEntry.timestamp);
  const recencyScore = getRecencyScore(daysAgo);
  const moodScore = getMoodScore(currentMood, historyEntry.mood);
  const topicScore = getTopicScore(currentTopic, historyEntry.topic);
  const contentScore = getContentSimilarity(currentEntry, historyEntry.text);

  // Use dynamic weights based on whether entries are from the same day
  // When entries are from the same day, prioritize topic similarity over recency
  let finalScore: number;
  if (isSameDay) {
    // Same-day entries: topic and content similarity matter more than recency
    // Penalize entries with different topics more heavily when they're from the same day
    let adjustedTopicScore = topicScore;

    // Strong penalty for different topics when entries are from the same day
    if (currentTopic && historyEntry.topic && topicScore < 0.5) {
      adjustedTopicScore = topicScore * 0.5; // Halve the score for different topics on same day
    }

    finalScore = (
      recencyScore * SAME_DAY_RECENCY_WEIGHT +
      moodScore * SAME_DAY_MOOD_WEIGHT +
      adjustedTopicScore * SAME_DAY_TOPIC_WEIGHT +
      contentScore * SAME_DAY_SIMILARITY_WEIGHT
    );
  } else {
    // Different days: use standard weights
    finalScore = (
      recencyScore * RECENCY_WEIGHT +
      moodScore * MOOD_WEIGHT +
      topicScore * TOPIC_WEIGHT +
      contentScore * SIMILARITY_WEIGHT
    );
  }

  // Build reasons array to explain why this entry is relevant
  const reasons: string[] = [];

  if (daysAgo <= 3) {
    if (daysAgo === 0) {
      reasons.push('same day');
    } else {
      reasons.push('recent');
    }
  }

  // Topic reasons (more important for same-day entries)
  if (topicScore >= 0.8 && currentTopic && historyEntry.topic) {
    reasons.push('same topic');
  } else if (topicScore >= 0.5 && currentTopic && historyEntry.topic) {
    reasons.push('related topic');
  } else if (currentTopic && historyEntry.topic && topicScore < 0.3) {
    // Different topic - mark it (especially important for same-day filtering)
    if (isSameDay) {
      reasons.push('different topic'); // This helps filter out same-day entries with different topics
    }
  }

  if (moodScore >= 0.7 && currentMood !== 'none' && historyEntry.mood !== 'none') {
    reasons.push('similar mood');
  }
  if (contentScore >= 0.3) {
    reasons.push('similar content');
  }

  // If no specific reasons but score is decent, just note it's relevant
  if (reasons.length === 0 && finalScore >= 0.4) {
    reasons.push('relevant');
  }

  return { score: finalScore, reasons };
}

// Format entry for context (uses summary for older entries to save tokens)
function formatEntryForContext(
  entry: HistoryEntry,
  includeReflection: boolean = false,
  relevanceScore?: number,
  relevanceReasons?: string[]
): string {
  const daysAgo = daysBetween(entry.timestamp);
  const dateStr = new Date(entry.timestamp).toLocaleDateString();

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

  // Add relevance label with reasons why this entry is relevant
  let relevanceLabel = '';
  if (relevanceReasons && relevanceReasons.length > 0) {
    const reasonsStr = relevanceReasons.join(', ');
    relevanceLabel = ` [Relevant: ${reasonsStr}]`;
  } else if (relevanceScore !== undefined) {
    relevanceLabel = ` [Relevance: ${(relevanceScore * 100).toFixed(0)}%]`;
  }

  let context = `[${dateStr} | ${entry.mood}${topicStr}${relevanceLabel}] ${entryText}`;

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
interface ContextEntry {
  entry: HistoryEntry;
  score: number;
  tokens: number;
  relevanceReasons?: string[];
}

function selectRelevantContext(
  currentEntry: string,
  currentMood: Mood,
  currentTopic: string | undefined,
  history: HistoryEntry[],
  maxTokens: number,
  includeReflection: boolean = false
): string {
  if (history.length === 0) {
    return "No previous history available.";
  }

  // Determine if entries are from today (same day as current entry)
  // This helps prioritize topic similarity for same-day entries
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Score all entries with relevance reasons
  const scoredEntries: ContextEntry[] = history.map(entry => {
    // Check if this entry is from today (for same-day scoring logic)
    // When entries are from the same day, topic similarity becomes more important
    const entryDate = new Date(entry.timestamp);
    entryDate.setHours(0, 0, 0, 0);
    const isSameDay = entryDate.getTime() === today.getTime();

    const { score, reasons } = calculateRelevanceScore(
      currentEntry,
      currentMood,
      currentTopic,
      entry,
      isSameDay
    );
    return {
      entry,
      score,
      relevanceReasons: reasons.length > 0 ? reasons : undefined,
      tokens: 0 // Will calculate after formatting
    };
  });

  // Filter out entries below minimum relevance threshold (unless very recent)
  const recentThreshold = 1; // Always include entries from last day regardless of score
  const filteredEntries = scoredEntries.filter(scored => {
    const daysAgo = daysBetween(scored.entry.timestamp);
    // Include if: meets minimum score OR is very recent (within 1 day)
    return scored.score >= MIN_RELEVANCE_SCORE || daysAgo <= recentThreshold;
  });

  if (filteredEntries.length === 0) {
    // If no entries meet threshold, use the most recent one
    const mostRecent = scoredEntries.sort((a, b) => {
      const dateA = new Date(a.entry.timestamp).getTime();
      const dateB = new Date(b.entry.timestamp).getTime();
      return dateB - dateA;
    })[0];
    if (mostRecent) {
      filteredEntries.push(mostRecent);
    }
  }

  // Calculate tokens for each entry
  filteredEntries.forEach(scored => {
    scored.tokens = estimateTokens(
      formatEntryForContext(scored.entry, includeReflection, scored.score, scored.relevanceReasons)
    );
  });

  // Sort by relevance score (highest first)
  filteredEntries.sort((a, b) => b.score - a.score);

  // Select entries that fit within token limit
  const selected: ContextEntry[] = [];
  let totalTokens = 0;

  for (const scored of filteredEntries) {
    // Check if we have room
    if (totalTokens + scored.tokens > maxTokens) {
      // Try to fit a shorter version (summary only)
      if (scored.entry.summary && !formatEntryForContext(scored.entry, includeReflection).includes('[Summary]')) {
        const summaryText = formatEntryForContext(
          scored.entry,
          false, // Don't include reflection in summary version
          scored.score,
          scored.relevanceReasons
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
  console.log(`[Context] Selected ${selected.length} of ${history.length} entries (${totalTokens} tokens)`);
  selected.forEach((scored, idx) => {
    const dateStr = new Date(scored.entry.timestamp).toLocaleDateString();
    console.log(`[Context ${idx + 1}] ${dateStr} - Score: ${(scored.score * 100).toFixed(0)}% - Reasons: ${scored.relevanceReasons?.join(', ') || 'none'}`);
  });

  // Sort selected entries by date (most recent last, to show progression)
  selected.sort((a, b) => {
    const dateA = new Date(a.entry.timestamp).getTime();
    const dateB = new Date(b.entry.timestamp).getTime();
    return dateA - dateB;
  });

  // Format the context with labels
  const contextParts = selected.map(scored =>
    formatEntryForContext(scored.entry, includeReflection, scored.score, scored.relevanceReasons)
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

export const getJournalReflection = async (
  entry: string,
  mood: string,
  history: HistoryEntry[]
): Promise<{ reflection: string; summary: string; topic?: string }> => {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured. Please set NEXT_PUBLIC_GEMINI_API_KEY in your .env.local file');
  }
  const ai = new GoogleGenAI({ apiKey });

  // Detect topic FIRST so we can use it for better context selection
  let detectedTopic: string | undefined;
  try {
    console.log('[getJournalReflection] Detecting topic for entry...');
    detectedTopic = await detectTopic(entry);
    if (detectedTopic) {
      console.log(`[getJournalReflection] ✅ Topic detected: "${detectedTopic}"`);
    } else {
      console.log('[getJournalReflection] ⚠️ No topic detected (entry may be too short or topic unclear)');
    }
  } catch (topicError) {
    console.error("[getJournalReflection] Topic detection error:", topicError);
    // Continue without topic if detection fails
  }

  // Use improved context selection with topic
  const historyContext = selectRelevantContext(
    entry,
    mood as Mood,
    detectedTopic,
    history,
    MAX_CONTEXT_TOKENS_REFLECTION,
    true // Include reflections for reflection generation
  );

  // Dynamic context sizing based on entry length
  const entryTokens = estimateTokens(entry);
  const adjustedMaxTokens = entryTokens > 500
    ? MAX_CONTEXT_TOKENS_REFLECTION - 300 // Reduce context for long entries
    : MAX_CONTEXT_TOKENS_REFLECTION;

  const prompt = `
### USER CONTEXT (RELEVANT PAST ENTRIES)
The following entries from the user's journal history have been selected because they are relevant to the current entry based on topic similarity, mood patterns, content similarity, or recency. Each entry is labeled with why it's relevant.

${historyContext}

### CURRENT ENTRY
Mood: ${mood}
Content: "${entry}"

**IMPORTANT:** 
- Focus primarily on the CURRENT ENTRY above
- Use the context entries to recognize patterns, acknowledge progress, or note recurring themes
- Only reference past entries when they add meaningful value to your reflection
- Do not let irrelevant past context distract from the user's current thoughts
- If past entries seem unrelated to the current entry, focus entirely on the current entry

Please provide your reflection and a concise summary.
**Also identify the main topic** (1-3 words) - what is the primary subject matter being discussed?
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
            reflection: { type: Type.STRING, description: "The AI's deep empathetic response." },
            summary: { type: Type.STRING, description: "A one-sentence summary of the entry's core theme." },
            topic: {
              type: Type.STRING,
              description: "The main topic or theme (1-3 words) - what is the primary subject matter being discussed? Examples: work stress, family conflict, health anxiety, creative projects, relationship struggles, career planning, etc. Focus on WHAT they're writing about, not emotional state."
            }
          },
          required: ["reflection", "summary", "topic"]
        }
      },
    });

    const data = JSON.parse(response.text || "{}");
    const reflectionContent = data.reflection || "I'm processing your thoughts. Thank you for sharing.";
    const summaryContent = data.summary || "A moment of reflection.";

    // Topic from reflection response (most accurate - AI understands full context)
    let finalTopic: string | undefined = data.topic;

    // Clean up topic from response
    if (finalTopic) {
      finalTopic = finalTopic
        .trim()
        .replace(/^["']|["']$/g, '')
        .split(/[,;.\n]/)[0]
        .split(/\s+/)
        .slice(0, 3)
        .join(' ')
        .trim();

      // Capitalize properly
      if (finalTopic) {
        finalTopic = finalTopic
          .toLowerCase()
          .split(/\s+/)
          .map(word => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' ');
      }
    }

    // Fallback to initial topic detection if reflection didn't provide one
    if (!finalTopic || finalTopic.toLowerCase() === 'general' || finalTopic.toLowerCase() === 'none') {
      console.log('[getJournalReflection] Topic from reflection not available or too generic, using initial detection');
      finalTopic = detectedTopic;

      // If still no topic, try detecting from reflection text as last resort
      if (!finalTopic) {
        try {
          console.log('[getJournalReflection] Attempting topic detection from reflection text...');
          const reflectionTopic = await detectTopic(reflectionContent);
          if (reflectionTopic) {
            finalTopic = reflectionTopic;
            console.log(`[getJournalReflection] ✅ Topic detected from reflection text: "${finalTopic}"`);
          }
        } catch (error) {
          console.warn('[getJournalReflection] Failed to detect topic from reflection text:', error);
        }
      }
    } else {
      console.log(`[getJournalReflection] ✅ Topic from reflection response: "${finalTopic}"`);
    }

    if (!finalTopic) {
      console.log('[getJournalReflection] ⚠️ No topic could be determined');
    }

    return {
      reflection: reflectionContent,
      summary: summaryContent,
      topic: finalTopic
    };
  } catch (error) {
    console.error("Gemini API Error:", error);
    throw error;
  }
};

export const startJournalChat = (
  entry: string,
  initialReflection: string,
  mood: string,
  history: HistoryEntry[],
  currentTopic?: string
): Chat => {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured. Please set NEXT_PUBLIC_GEMINI_API_KEY in your .env.local file');
  }
  const ai = new GoogleGenAI({ apiKey });

  // Use improved context selection for chat (more focused, less tokens)
  // Use topic from the current reflection for better context
  const historyContext = selectRelevantContext(
    entry,
    mood as Mood,
    currentTopic,
    history,
    MAX_CONTEXT_TOKENS_CHAT,
    false // Don't include full reflections in chat context to save tokens
  );

  return ai.chats.create({
    model: 'gemini-3-flash-preview',
    config: {
      systemInstruction: `${SYSTEM_INSTRUCTION}

CONTEXT FOR THIS CONVERSATION:
Journal Entry: ${entry}
Mood: ${mood}
Your Initial Reflection: ${initialReflection}

Relevant Past Context (labeled with relevance reasons):
${historyContext}

**IMPORTANT:** 
- Focus on the current conversation context above
- Use past entries only when they directly relate to what the user is asking
- Do not reference irrelevant past context - focus on answering the current question
- Each past entry is labeled with why it's relevant - ignore entries that don't match the current discussion`,
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
  console.log(`[detectTopic] Called with entry length: ${entry.trim().length}`);

  if (!entry.trim() || entry.trim().length < 15) {
    console.log(`[detectTopic] Entry too short (${entry.trim().length} chars), skipping topic detection`);
    return undefined; // Need minimum text to detect topic
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    console.warn('[detectTopic] No API key available, skipping topic detection');
    return undefined; // Fail silently if no API key
  }

  console.log('[detectTopic] Starting topic detection...');
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
      console.log(`[detectTopic] Topic detected with ${confidence} confidence: "${detectedTopic}"`);
    } catch (parseError) {
      // Fallback to text parsing if JSON parsing fails
      detectedTopic = (response.text || '').trim();
      console.warn('[detectTopic] JSON parse failed, using text response:', detectedTopic);
    }

    if (!detectedTopic) {
      console.log('[detectTopic] No topic detected in response');
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
      console.log(`[detectTopic] Topic filtered out (generic/empty): "${cleanedTopic}"`);
      return undefined;
    }

    // Capitalize first letter of each word for better formatting
    const finalTopic = cleanedTopic
      .split(/\s+/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
    console.log(`[detectTopic] Raw: "${detectedTopic}" -> Cleaned: "${finalTopic}"`);
    return finalTopic;
  } catch (error) {
    console.error("Topic detection error:", error);
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

// Generate speech with retry logic
async function generateSpeechChunk(
  text: string,
  retries: number = 3,
  delay: number = 1000
): Promise<string | undefined> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured. Please set NEXT_PUBLIC_GEMINI_API_KEY in your .env.local file');
  }

  const ai = new GoogleGenAI({ apiKey });
  const cleanedContent = cleanTextForTTS(text);

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: `Speak warmly and gently: ${cleanedContent}` }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Kore' },
            },
          },
        },
      });

      const audioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (audioData) {
        return audioData;
      }
    } catch (error) {
      const isLastAttempt = attempt === retries - 1;
      if (isLastAttempt) {
        console.error(`TTS Error after ${retries} attempts:`, error);
        throw error;
      }

      // Exponential backoff: wait longer between retries
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
  const { useCache = false, chunked = false } = options || {};

  // Check cache if enabled (will be handled by caller)

  // Create hash for request deduplication
  const textHash = text.trim().toLowerCase();

  // Check if there's already a pending request for this text
  const pendingRequest = pendingTTSRequests.get(textHash);
  if (pendingRequest) {
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

    // Multiple chunks - generate all in parallel
    const chunkPromises = chunks.map(chunk => {
      const chunkHash = chunk.trim().toLowerCase();
      const existing = pendingTTSRequests.get(chunkHash);
      if (existing) return existing;

      const request = generateSpeechChunk(chunk);
      pendingTTSRequests.set(chunkHash, request);
      return request.finally(() => pendingTTSRequests.delete(chunkHash));
    });

    try {
      const results = await Promise.all(chunkPromises);
      return results.filter((r): r is string => r !== undefined);
    } catch (error) {
      throw error;
    }
  }

  // Single generation (original behavior for backward compatibility)
  const request = generateSpeechChunk(text);
  pendingTTSRequests.set(textHash, request);

  try {
    const result = await request;
    pendingTTSRequests.delete(textHash);
    return result;
  } catch (error) {
    pendingTTSRequests.delete(textHash);
    throw error;
  }
};
