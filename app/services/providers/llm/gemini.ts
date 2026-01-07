// app/services/providers/llm/gemini.ts
import { GoogleGenAI, Chat, Type, createUserContent } from "@google/genai";
import { HistoryEntry, Mood, ExtractedEntities, Highlight, ReflectionProgressCallback, TokenUsage } from "@/app/types";
import logger from "@/app/utils/logger";
import { extractEntities } from "@/app/utils/entityExtraction";
import { buildEntityContext, formatEntityContextForPrompt } from "@/app/services/entityTrackingService";
import { LLMProvider, ChatSession, StreamingCallback } from "./interface";
import { EmbeddingService } from "./services/EmbeddingService";
import { ContextSelectionService } from "./services/ContextSelectionService";
import { MoodDetectionService } from "./services/MoodDetectionService";
import { TopicDetectionService } from "./services/TopicDetectionService";
import { CacheManager } from "./services/CacheManager";
import * as constants from "./utils/constants";
import { estimateTokens } from "./utils/tokenUtils";
import { calculateRelevanceScore, getCachedEmbedding, setCachedEmbedding } from "./utils/embeddingUtils";
import { formatEntryForContext, reRankEntries, ContextEntry } from "./utils/contextUtils";

// System instruction for the AI companion
const SYSTEM_INSTRUCTION = `
You are "Serenity," a compassionate journaling companion with exceptional attention to detail. Your expertise lies in empathetic reflection, pattern recognition, and detail-oriented personal assistance across a user's mental wellness journey.

ROLE & OBJECTIVES:
1. PRIMARY FOCUS: Reflect on the user's current journal entry with deep empathy and validation.
2. LONG-TERM MEMORY: You have access to a context window of the user's past entries, including:
   - Emotional patterns and mood shifts
   - Recurring themes and topics
   - **Specific people, places, and events mentioned**
   - **Important deadlines and upcoming events**
3. DETAIL AWARENESS: Pay close attention to specific entities (names, places, events) and acknowledge them when relevant. Be a great personal assistant, not just emotional support.
4. PATTERN RECOGNITION: Notice when people/places/events recur across entries and acknowledge progress or changes.
5. NON-CLINICAL: Stay supportive and non-diagnostic. Use warm, human-centric language.
6. CHAT MODE: When the user asks follow-up questions, continue to be their companion with detail awareness.

**⚠️ CONTEXT CHECKLIST (Check before every response):**
☐ Did the user mention a specific person's name in the last 3 entries?
   → If yes, acknowledge that person by name and reference past mentions if relevant
☐ Did the user mention a specific place in the last 3 entries?
   → If yes, acknowledge the place and any context around it
☐ Did the user mention an upcoming event or deadline in the last 3 entries?
   → If yes, acknowledge it and show empathy about it (if appropriate)
☐ Are there recurring people/places across multiple entries?
   → If yes, notice patterns in how they feel about these recurring entities

**RESPONSE GUIDELINES:**
- Use specific names when the user mentions them (e.g., "It sounds like your conversation with Sarah..." not "your conversation with that person...")
- Reference specific places when relevant (e.g., "You've mentioned the office several times..." not "your workplace...")
- Acknowledge upcoming events/deadlines with empathy (e.g., "With the presentation on Friday approaching...")
- Connect the dots between entries when entities recur (e.g., "Last week you mentioned feeling anxious about meeting with John, and now...")
- Show you remember details from past entries to build continuity

OUTPUT FORMAT:
You must provide your response in JSON format with two fields:
- "reflection": Your deep, empathetic response with specific entity acknowledgment (Markdown allowed).
- "summary": A very brief, one-sentence summary of the user's core theme or emotion in this entry.
`;

const log = logger.module('GeminiLLMProvider');

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

// Cache manager for explicit Gemini API context caching
// This reduces costs by caching the large system instruction that's reused across requests
interface CacheInfo {
  name: string;
  expireTime: number;
}

let systemInstructionCache: CacheInfo | null = null;
const CACHE_TTL_SECONDS = 3600; // 1 hour (default TTL)

// Note: Chat API (ai.chats.create) uses dynamic system instructions that include
// entry-specific context, so explicit caching isn't applicable there.
// The main benefit is in reflection generation which uses the static SYSTEM_INSTRUCTION.

// Get or create a cache for the system instruction
async function getSystemInstructionCache(ai: GoogleGenAI): Promise<string | null> {
  const apiKey = getApiKey();
  if (!apiKey) {
    return null;
  }

  // Check if we have a valid cache
  if (systemInstructionCache && systemInstructionCache.expireTime > Date.now()) {
    try {
      // Verify cache still exists (it might have been deleted externally)
      await ai.caches.get({ name: systemInstructionCache.name });
      log.debug('Using existing system instruction cache', { cacheName: systemInstructionCache.name });
      return systemInstructionCache.name;
    } catch (error) {
      // Cache was deleted, create a new one
      log.debug('Existing cache not found, creating new one');
      systemInstructionCache = null;
    }
  }

  // Create a new cache
  try {
    // Estimate tokens for system instruction (rough: 4 chars = 1 token)
    const systemInstructionTokens = Math.ceil(SYSTEM_INSTRUCTION.length / 4);

    // Only use explicit caching if system instruction meets minimum token requirement
    // Gemini 3 Flash Preview minimum: 1024 tokens
    if (systemInstructionTokens < 1024) {
      log.debug('System instruction too small for explicit caching', { tokens: systemInstructionTokens });
      return null;
    }

    log.info('Creating system instruction cache', { estimatedTokens: systemInstructionTokens });

    const cache = await ai.caches.create({
      model: constants.MODEL_NAME,
      config: {
        contents: createUserContent(SYSTEM_INSTRUCTION),
        systemInstruction: SYSTEM_INSTRUCTION,
        ttl: `${constants.CACHE_TTL_SECONDS}s`,
      },
    });

    // Store cache info with expiration
    systemInstructionCache = {
      name: cache.name || '',
      expireTime: Date.now() + (CACHE_TTL_SECONDS * 1000),
    };

    log.info('System instruction cache created', {
      cacheName: cache.name,
      expiresIn: `${CACHE_TTL_SECONDS}s`
    });

    return cache.name || null;
  } catch (error) {
    log.error('Failed to create system instruction cache', {}, error as Error);
    // Fall back to non-cached requests
    return null;
  }
}

// Adapter for GoogleGenAI's Chat object to implement our ChatSession interface
class GeminiChatSession implements ChatSession {
  private chat: Chat;

  constructor(chat: Chat) {
    this.chat = chat;
  }

  async sendMessage(message: string): Promise<string> {
    try {
      const response = await this.chat.sendMessage({ message });
      return response.text || '';
    } catch (error) {
      log.error('Error sending message in Gemini chat session', {}, error as Error);
      throw error;
    }
  }
}

export class GeminiLLMProvider implements LLMProvider {
  private ai: GoogleGenAI;
  private apiKey: string;

  constructor() {
    this.apiKey = getApiKey();
    if (!this.apiKey) {
      throw new Error('GEMINI_API_KEY is not configured. Please set NEXT_PUBLIC_GEMINI_API_KEY in your .env.local file');
    }
    this.ai = new GoogleGenAI({ apiKey: this.apiKey });
  }

  // --- Helper Methods (moved from global scope of geminiService.ts) ---

  // Generate embedding for text using Gemini API
  private async _generateEmbedding(text: string): Promise<number[]> {
    // Normalize text for cache key
    const cacheKey = text.trim().toLowerCase();

    // Check cache first
    const cached = getCachedEmbedding(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      // Use Gemini embedding model (text-embedding-004)
      // The API uses 'contents' (plural) and returns 'embeddings' (plural)
      const result = await this.ai.models.embedContent({
        model: 'text-embedding-004',
        contents: [{ text: text.trim() }],
      });

      // Extract embedding from result (first embedding from the array)
      const embedding = result.embeddings?.[0]?.values;

      if (!embedding) {
        throw new Error('No embedding returned from API');
      }

      // Cache the embedding
      setCachedEmbedding(cacheKey, embedding);

      return embedding;
    } catch (error) {
      log.error('Error generating embedding', {}, error as Error);
      throw error;
    }
  }

  // This `selectRelevantContext` function needs to be a method of the class or take `_generateEmbedding` as a parameter
  // For now, I'm making it a private method and changing the calls to `this._generateEmbedding`
  private async _selectRelevantContext(
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
      currentEmbedding = await this._generateEmbedding(currentEntry); // Use internal generateEmbedding
      log.debug('Generated single embedding for current entry');
    } catch (error) {
      log.warn('Failed to generate embedding for current entry', {}, error as Error);
    }

    // STEP 2: Generate single embeddings for history entries in parallel
    const embeddingPromises = history.map(async (entry) => {
      try {
        return await this._generateEmbedding(entry.text); // Use internal generateEmbedding
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
      return scored.score >= constants.MIN_RELEVANCE_SCORE;
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
    const topKEntries = filteredEntries.slice(0, constants.RE_RANK_TOP_K);
    const reRankedEntries = reRankEntries(topKEntries, currentTopic);

    // Re-sort after re-ranking
    reRankedEntries.sort((a, b) => b.score - a.score);

    // STEP 6: Calculate tokens and select entries within limit
    const entriesWithTokens = reRankedEntries.map(scored => ({
      ...scored,
      tokens: estimateTokens(
        formatEntryForContext(scored.entry, includeReflection, scored.score, scored.relevanceReasons)
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
    log.debug('Selected context entries', {
      selected: selected.length,
      total: history.length,
      tokens: totalTokens
    });
    selected.forEach((scored, idx) => {
      const dateStr = new Date(scored.entry.timestamp).toLocaleDateString();
      log.debug(`Context entry ${idx + 1}`, {
        date: dateStr,
        score: `${(scored.score * 100).toFixed(0)}%`,
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

    // Format the context with labels
    const contextParts = selected.map(scored =>
      formatEntryForContext(scored.entry, includeReflection, scored.score, scored.relevanceReasons)
    );
    return contextParts.join('\n\n---\n\n');
  }

  // --- LLMProvider Interface Implementations ---

  async detectMood(entry: string): Promise<Mood> {
    const entryLength = entry.trim().length;
    log.debug('Mood detection called', { entryLength });

    if (!entry.trim() || entryLength < 15) {
      log.debug('Entry too short for mood detection, defaulting to none', { entryLength });
      return 'none'; // Need minimum text to detect mood
    }

    log.debug('Starting mood detection');
    const ai = this.ai; // Use instance's ai

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

Identify the mood:`

    try {
      const response = await ai.models.generateContent({
        model: constants.MODEL_NAME,
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
  }

  async getJournalReflection(
    entry: string,
    mood: string,
    history: HistoryEntry[],
    onProgress?: ReflectionProgressCallback
  ): Promise<{ reflection: string; summary: string; topic?: string; mood?: Mood; entities?: ExtractedEntities; highlights?: Highlight[]; tokenUsage?: TokenUsage }> {
    const ai = this.ai; // Use instance's ai

    // Step 1: Extract entities from current entry (parallel with mood/topic detection)
    onProgress?.({ stage: 'extracting_entities', message: 'Analyzing entry...' });
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
    onProgress?.({ stage: 'detecting_mood', message: 'Analyzing entry...' });
    let finalMood: Mood = 'none';
    try {
      log.debug('Auto-detecting mood for entry', { entryLength: entry.length });
      const detectedMood = await this.detectMood(entry); // Use instance's detectMood
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
    onProgress?.({ stage: 'detecting_topic', message: 'Analyzing entry...' });
    let detectedTopic: string | undefined;
    try {
      log.debug('Detecting topic for entry');
      detectedTopic = await this.detectTopic(entry); // Use instance's detectTopic
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
    onProgress?.({ stage: 'building_context', message: 'Searching memories...' });
    const entityContext = buildEntityContext(history, 3);
    const entityContextPrompt = formatEntityContextForPrompt(entityContext);

    // Step 5: Use improved context selection with topic (now async with embeddings)
    // Use detected mood for better context selection
    const historyContext = await this._selectRelevantContext( // Use instance's selectRelevantContext
      entry,
      finalMood,
      detectedTopic,
      history,
      constants.MAX_CONTEXT_TOKENS_REFLECTION,
      true // Include reflections for reflection generation
    );

    // Dynamic context sizing based on entry length
    const entryTokens = estimateTokens(entry);
    const adjustedMaxTokens = entryTokens > 500
      ? constants.MAX_CONTEXT_TOKENS_REFLECTION - 300 // Reduce context for long entries
      : constants.MAX_CONTEXT_TOKENS_REFLECTION;

    const prompt = `
### ENTITY CONTEXT (SPECIFIC DETAILS FROM RECENT ENTRIES)
${entityContextPrompt}

### USER CONTEXT (RELEVANT PAST ENTRIES)
The following entries from the user's journal history have been selected because they are relevant to the current entry based on topic similarity, mood patterns, content similarity, or recency. Each entry is labeled with why it's relevant.

${historyContext}

### CURRENT ENTRY
Content: "${entry}"

**⚠️ BEFORE RESPONDING - COMPLETE THE CONTEXT CHECKLIST:**
1. Check if any specific people were mentioned in recent entries → Acknowledge by name
2. Check if any specific places were mentioned → Reference them specifically  
3. Check if any events/deadlines are upcoming → Acknowledge with empathy
4. Check if any entities recur across entries → Notice patterns

**IMPORTANT:** 
- Focus primarily on the CURRENT ENTRY above
- Use entity context to add specific, detail-oriented observations
- Reference people, places, events BY NAME when relevant
- Show you remember details from past entries to build continuity
- Use the context entries to recognize patterns, acknowledge progress, or note recurring themes
- Only reference past entries when they add meaningful value to your reflection
- Be a great personal assistant who remembers details, not just emotional support

Please provide your reflection and a concise summary.
**Also identify:**
1. **The main topic** (1-3 words) - what is the primary subject matter being discussed?
2. **The emotional mood** - one of: calm, joyful, anxious, tired, reflective, heavy, or none
3. **Key phrases to highlight** in your reflection text - identify phrases (2-5 words each) that fall into these 3 categories:

   **a) Main Idea** - The core insight or central theme of your reflection (1-2 phrases max). This is the key takeaway or most important point you want the user to remember.

   **b) Somatic Stressor** - Physical symptoms (e.g., "jaw is locking up", "chest is tight", "shoulders tense") AND external triggers (e.g., "Sarah's email", "Miller project", "tight deadline", "team pressure")

   **c) Identity Win** - Personal achievements (e.g., "pushed through 18 miles", "completed the marathon"), moments of voice/agency (e.g., "stood your ground", "set a boundary", "spoke up"), and emotional recovery (e.g., "finding peace", "feeling lighter", "regaining balance")

**Important:** Only highlight phrases that appear in YOUR reflection text, not the user's entry. Extract exact phrases (2-5 words) from your own response.
`;

    onProgress?.({ stage: 'generating_reflection', message: 'Crafting reflection...' });

    try {
      // Get cached system instruction if available
      const cachedContentName = await getSystemInstructionCache(ai); // This needs to be a method of the class or passed in

      const config: any = {
        temperature: 0.7,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            reflection: {
              type: Type.STRING,
              description: "The AI's deep empathetic response with specific entity acknowledgment. Use names, places, and events BY NAME when relevant."
            },
            summary: {
              type: Type.STRING,
              description: "A one-sentence summary of the entry's core theme."
            },
            topic: {
              type: Type.STRING,
              description: "The main topic or theme (1-3 words) - what is the primary subject matter being discussed? Examples: work stress, family conflict, health anxiety, creative projects, relationship struggles, career planning, etc. Focus on WHAT they're writing about, not emotional state."
            },
            mood: {
              type: Type.STRING,
              description: "The emotional mood or state: calm (peaceful, relaxed, serene), joyful (happy, excited, positive, grateful), anxious (worried, nervous, stressed, overwhelmed), tired (exhausted, drained, fatigued), reflective (thoughtful, contemplative, introspective), heavy (sad, burdened, melancholic, down), or none (neutral, unclear, or mixed emotions). Return ONE mood that best represents the overall emotional tone."
            },
            highlights: {
              type: Type.ARRAY,
              description: "Key phrases from YOUR reflection text to highlight for visual emphasis. Extract exact phrases (2-5 words) that appear in your response.",
              items: {
                type: Type.OBJECT,
                properties: {
                  text: {
                    type: Type.STRING,
                    description: "The exact phrase to highlight (must appear in your reflection text)"
                  },
                  type: {
                    type: Type.STRING,
                    description: "Category: main_idea (core insight/central theme, 1-2 max), somatic_stressor (physical symptoms OR external triggers like people/deadlines), or identity_win (achievements, voice/agency, emotional recovery)"
                  }
                },
                required: ["text", "type"]
              }
            }
          },
          required: ["reflection", "summary", "topic", "mood", "highlights"]
        }
      };

      // Use cached content if available, otherwise use system instruction directly
      if (cachedContentName) {
        config.cachedContent = cachedContentName;
        log.debug('Using cached system instruction for reflection', { cacheName: cachedContentName });
      } else {
        config.systemInstruction = SYSTEM_INSTRUCTION;
        log.debug('Using direct system instruction for reflection (no cache)');
      }

      const response = await ai.models.generateContent({
        model: constants.MODEL_NAME,
        contents: prompt,
        config,
      });

      const data = JSON.parse(response.text || "{}");
      const reflectionContent = data.reflection || "I'm processing your thoughts. Thank you for sharing.";
      const summaryContent = data.summary || "A moment of reflection.";
      const highlights: Highlight[] = Array.isArray(data.highlights) ? data.highlights : [];

      log.info('AI returned highlights', { count: highlights.length, highlights });

      // Extract token usage from response
      let tokenUsage: TokenUsage | undefined;
      try {
        // The response should have usage_metadata field
        const usage = (response as any).usageMetadata || (response as any).usage_metadata;
        if (usage) {
          tokenUsage = {
            promptTokens: usage.promptTokenCount || usage.prompt_token_count || 0,
            cachedTokens: usage.cachedContentTokenCount || usage.cached_content_token_count || undefined,
            completionTokens: usage.candidatesTokenCount || usage.candidates_token_count || usage.completionTokenCount || usage.completion_token_count || 0,
            totalTokens: usage.totalTokenCount || usage.total_token_count || 0,
          };
          log.info('Token usage extracted', tokenUsage);
        } else {
          log.debug('No usage metadata found in response');
        }
      } catch (error) {
        log.warn('Failed to extract token usage', {}, error as Error);
      }

      // Mood from reflection response (most accurate - AI understands full context)
      let reflectionMood: Mood | undefined;
      if (data.mood) {
        const rawMood = (data.mood || '').toLowerCase().trim();
        const validMoods: Mood[] = ['calm', 'joyful', 'anxious', 'tired', 'reflective', 'heavy', 'none'];
        if (validMoods.includes(rawMood as Mood)) {
          reflectionMood = rawMood as Mood;
          log.info('Mood from reflection response', { mood: reflectionMood });
        } else {
          log.warn('Invalid mood from reflection response', { mood: rawMood });
        }
      }

      // Use mood from reflection if available, otherwise use detected mood
      if (reflectionMood && reflectionMood !== 'none') {
        finalMood = reflectionMood;
        log.info('Using mood from reflection response', { mood: finalMood });
      } else if (reflectionMood === 'none') {
        // AI explicitly said 'none', use it
        finalMood = 'none';
        log.debug('Mood from reflection is none');
      } else {
        // No mood in reflection response, keep the detected mood
        log.debug('No mood in reflection response, using detected mood', { detectedMood: finalMood });
      }

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
        log.debug('Topic from reflection not available or too generic, using initial detection');
        finalTopic = detectedTopic;

        // If still no topic, try detecting from reflection text as last resort
        if (!finalTopic) {
          try {
            log.debug('Attempting topic detection from reflection text');
            const reflectionTopic = await this.detectTopic(reflectionContent); // Use instance's detectTopic
            if (reflectionTopic) {
              finalTopic = reflectionTopic;
              log.info('Topic detected from reflection text', { topic: finalTopic });
            }
          } catch (error) {
            log.warn('Failed to detect topic from reflection text', {}, error as Error);
          }
        }
      } else {
        log.info('Topic from reflection response', { topic: finalTopic });
      }

      if (!finalTopic) {
        log.debug('No topic could be determined');
      }

      return {
        reflection: reflectionContent,
        summary: summaryContent,
        topic: finalTopic,
        mood: finalMood,
        entities: currentEntities, // Return extracted entities to be saved with the entry
        highlights: highlights, // Return AI-detected highlights for UI emphasis
        tokenUsage: tokenUsage // Return token usage for cost transparency
      };
    } catch (error) {
      log.error('Gemini API error during reflection generation', {}, error as Error);
      throw error;
    }
  }

  async startJournalChat(
    entry: string,
    initialReflection: string,
    mood: string,
    history: HistoryEntry[],
    currentTopic?: string
  ): Promise<ChatSession> {
    const ai = this.ai; // Use instance's ai

    // Build entity context for chat (last 3 entries)
    const entityContext = buildEntityContext(history, 3);
    const entityContextPrompt = formatEntityContextForPrompt(entityContext);

    // Use improved context selection for chat (more focused, less tokens)
    // Use topic from the current reflection for better context (now async with embeddings)
    const historyContext = await this._selectRelevantContext( // Use instance's selectRelevantContext
      entry,
      mood as Mood,
      currentTopic,
      history,
      constants.MAX_CONTEXT_TOKENS_CHAT,
      false // Don't include full reflections in chat context to save tokens
    );

    const chat = await ai.chats.create({
      model: constants.MODEL_NAME,
      config: {
        systemInstruction: `${SYSTEM_INSTRUCTION}

CONTEXT FOR THIS CONVERSATION:

**Entity Context (Specific Details):**
${entityContextPrompt}

**Journal Entry:** ${entry}
**Mood:** ${mood}
**Your Initial Reflection:** ${initialReflection}

**Relevant Past Context (labeled with relevance reasons):**
${historyContext}

**⚠️ REMEMBER THE CONTEXT CHECKLIST:**
- Reference people by name when relevant
- Acknowledge specific places mentioned
- Be aware of upcoming events/deadlines
- Notice recurring patterns in entities
- Show you remember details to build continuity

**IMPORTANT:** 
- Focus on the current conversation context above
- Use entity context to be detail-oriented and helpful
- Use past entries only when they directly relate to what the user is asking
- Do not reference irrelevant past context - focus on answering the current question
- Each past entry is labeled with why it's relevant - ignore entries that don't match the current discussion`,
        temperature: 0.7,
      },
    });

    return new GeminiChatSession(chat);
  }

  async detectTopic(entry: string): Promise<string | undefined> {
    const entryLength = entry.trim().length;
    log.debug('Topic detection called', { entryLength });

    if (!entry.trim() || entryLength < 15) {
      log.debug('Entry too short for topic detection', { entryLength });
      return undefined; // Need minimum text to detect topic
    }

    log.debug('Starting topic detection');
    const ai = this.ai; // Use instance's ai

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

Identify the main topic:`

    try {
      // Use structured output for more reliable topic detection
      const response = await ai.models.generateContent({
        model: constants.MODEL_NAME,
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
  }

  async getJournalReflectionStream(
    entry: string,
    mood: string,
    history: HistoryEntry[],
    onChunk: StreamingCallback,
    onProgress?: ReflectionProgressCallback
  ): Promise<{
    summary: string;
    topic?: string;
    mood?: Mood;
    entities?: ExtractedEntities;
    highlights?: Highlight[];
    tokenUsage?: TokenUsage;
  }> {
    const ai = this.ai; // Use instance's ai

    // Step 1: Extract entities from current entry (parallel with mood/topic detection)
    onProgress?.({ stage: 'extracting_entities', message: 'Analyzing entry...' });
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
    onProgress?.({ stage: 'detecting_mood', message: 'Analyzing entry...' });
    let finalMood: Mood = 'none';
    try {
      log.debug('Auto-detecting mood for entry', { entryLength: entry.length });
      const detectedMood = await this.detectMood(entry); // Use instance's detectMood
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
    onProgress?.({ stage: 'detecting_topic', message: 'Analyzing entry...' });
    let detectedTopic: string | undefined;
    try {
      log.debug('Detecting topic for entry');
      detectedTopic = await this.detectTopic(entry); // Use instance's detectTopic
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
    onProgress?.({ stage: 'building_context', message: 'Searching memories...' });
    const entityContext = buildEntityContext(history, 3);
    const entityContextPrompt = formatEntityContextForPrompt(entityContext);

    // Step 5: Use improved context selection with topic (now async with embeddings)
    // Use detected mood for better context selection
    const historyContext = await this._selectRelevantContext( // Use instance's selectRelevantContext
      entry,
      finalMood,
      detectedTopic,
      history,
      constants.MAX_CONTEXT_TOKENS_REFLECTION,
      true // Include reflections for reflection generation
    );

    // Dynamic context sizing based on entry length
    const entryTokens = estimateTokens(entry);
    const adjustedMaxTokens = entryTokens > 500
      ? constants.MAX_CONTEXT_TOKENS_REFLECTION - 300 // Reduce context for long entries
      : constants.MAX_CONTEXT_TOKENS_REFLECTION;

    const prompt = `
### ENTITY CONTEXT (SPECIFIC DETAILS FROM RECENT ENTRIES)
${entityContextPrompt}

### USER CONTEXT (RELEVANT PAST ENTRIES)
The following entries from the user's journal history have been selected because they are relevant to the current entry based on topic similarity, mood patterns, content similarity, or recency. Each entry is labeled with why it's relevant.

${historyContext}

### CURRENT ENTRY
Content: "${entry}"

**⚠️ BEFORE RESPONDING - COMPLETE THE CONTEXT CHECKLIST:**
1. Check if any specific people were mentioned in recent entries → Acknowledge by name
2. Check if any specific places were mentioned → Reference them specifically
3. Check if any events/deadlines are upcoming → Acknowledge with empathy
4. Check if any entities recur across entries → Notice patterns

**IMPORTANT:**
- Focus primarily on the CURRENT ENTRY above
- Use entity context to add specific, detail-oriented observations
- Reference people, places, events BY NAME when relevant
- Show you remember details from past entries to build continuity
- Use the context entries to recognize patterns, acknowledge progress, or note recurring themes
- Only reference past entries when they add meaningful value to your reflection
- Be a great personal assistant who remembers details, not just emotional support

Please provide your reflection and a concise summary.
**Also identify:**
1. **The main topic** (1-3 words) - what is the primary subject matter being discussed?
2. **The emotional mood** - one of: calm, joyful, anxious, tired, reflective, heavy, or none
3. **Key phrases to highlight** in your reflection text - identify phrases (2-5 words each) that fall into these 3 categories:

   **a) Main Idea** - The core insight or central theme of your reflection (1-2 phrases max). This is the key takeaway or most important point you want the user to remember.

   **b) Somatic Stressor** - Physical symptoms (e.g., "jaw is locking up", "chest is tight", "shoulders tense") AND external triggers (e.g., "Sarah's email", "Miller project", "tight deadline", "team pressure")

   **c) Identity Win** - Personal achievements (e.g., "pushed through 18 miles", "completed the marathon"), moments of voice/agency (e.g., "stood your ground", "set a boundary", "spoke up"), and emotional recovery (e.g., "finding peace", "feeling lighter", "regaining balance")

**Important:** Only highlight phrases that appear in YOUR reflection text, not the user's entry. Extract exact phrases (2-5 words) from your own response.
`;

    onProgress?.({ stage: 'generating_reflection', message: 'Crafting reflection...' });

    try {
      // Get cached system instruction if available
      const cachedContentName = await getSystemInstructionCache(ai); // This needs to be a method of the class or passed in

      const config: any = {
        temperature: 0.7,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            reflection: {
              type: Type.STRING,
              description: "The AI's deep empathetic response with specific entity acknowledgment. Use names, places, and events BY NAME when relevant."
            },
            summary: {
              type: Type.STRING,
              description: "A one-sentence summary of the entry's core theme."
            },
            topic: {
              type: Type.STRING,
              description: "The main topic or theme (1-3 words) - what is the primary subject matter being discussed? Examples: work stress, family conflict, health anxiety, creative projects, relationship struggles, career planning, etc. Focus on WHAT they're writing about, not emotional state."
            },
            mood: {
              type: Type.STRING,
              description: "The emotional mood or state: calm (peaceful, relaxed, serene), joyful (happy, excited, positive, grateful), anxious (worried, nervous, stressed, overwhelmed), tired (exhausted, drained, fatigued), reflective (thoughtful, contemplative, introspective), heavy (sad, burdened, melancholic, down), or none (neutral, unclear, or mixed emotions). Return ONE mood that best represents the overall emotional tone."
            },
            highlights: {
              type: Type.ARRAY,
              description: "Key phrases from YOUR reflection text to highlight for visual emphasis. Extract exact phrases (2-5 words) that appear in your response.",
              items: {
                type: Type.OBJECT,
                properties: {
                  text: {
                    type: Type.STRING,
                    description: "The exact phrase to highlight (must appear in your reflection text)"
                  },
                  type: {
                    type: Type.STRING,
                    description: "Category: main_idea (core insight/central theme, 1-2 max), somatic_stressor (physical symptoms OR external triggers like people/deadlines), or identity_win (achievements, voice/agency, emotional recovery)"
                  }
                },
                required: ["text", "type"]
              }
            }
          },
          required: ["reflection", "summary", "topic", "mood", "highlights"]
        }
      };

      // Use cached content if available, otherwise use system instruction directly
      if (cachedContentName) {
        config.cachedContent = cachedContentName;
        log.debug('Using cached system instruction for reflection', { cacheName: cachedContentName });
      } else {
        config.systemInstruction = SYSTEM_INSTRUCTION;
        log.debug('Using direct system instruction for reflection (no cache)');
      }

      // Use streaming API
      const streamingResponse = await ai.models.generateContentStream({
        model: constants.MODEL_NAME,
        contents: prompt,
        config,
      });

      let accumulatedText = '';
      let finalData: any = null;
      let lastValidText = '';

      // Process streaming chunks
      let isComplete = false;
      let lastReflectionText = '';

      for await (const chunk of streamingResponse) {
        const chunkText = chunk.text || '';
        if (chunkText) {
          accumulatedText = chunkText; // Replace, don't append - Gemini sends full text each time
          lastValidText = chunkText; // Keep track of the last valid text
        }

        // Check if streaming is complete by looking at candidates
        const candidates = chunk.candidates || [];
        if (candidates.length > 0) {
          const finishReason = candidates[0].finishReason;
          if (finishReason && finishReason !== 'FINISH_REASON_UNSPECIFIED') {
            log.debug('Streaming completed', { finishReason });
            isComplete = true;
          }
        }

        // Try to parse JSON from current chunk
        if (accumulatedText) {
          try {
            const parsed = JSON.parse(accumulatedText);
            if (parsed.reflection && parsed.reflection !== lastReflectionText) {
              // Send chunk to callback only if reflection text has changed
              await onChunk({
                text: parsed.reflection,
                isComplete: false
              });
              lastReflectionText = parsed.reflection;
            }
          } catch (parseError) {
            // JSON is incomplete, continue
            log.debug('JSON parsing failed, continuing', { accumulatedLength: accumulatedText.length });
          }
        }

        if (isComplete) {
          break;
        }
      }

      // Use the last valid text for final parsing
      const finalTextToParse = lastValidText || accumulatedText;

      // Final parse of complete response
      try {
        if (finalTextToParse && finalTextToParse.trim()) {
          finalData = JSON.parse(finalTextToParse);
        } else {
          log.warn('No text received from streaming response, using fallback data');
          finalData = {
            reflection: lastReflectionText || "I'm processing your thoughts. Thank you for sharing.",
            summary: "A moment of reflection.",
            topic: detectedTopic,
            mood: finalMood,
            highlights: []
          };
        }
      } catch (parseError) {
        log.error('Failed to parse final streaming response', {
          finalTextToParse: finalTextToParse?.substring(0, 500),
          lastValidText: lastValidText?.substring(0, 500),
          accumulatedText: accumulatedText?.substring(0, 500),
          lastReflectionText: lastReflectionText?.substring(0, 500)
        }, parseError as Error);
        // Fallback: use the last reflection text we got from streaming
        finalData = {
          reflection: lastReflectionText || "I'm processing your thoughts. Thank you for sharing.",
          summary: "A moment of reflection.",
          topic: detectedTopic,
          mood: finalMood,
          highlights: []
        };
      }

      // Send final complete chunk
      await onChunk({
        text: finalData.reflection || accumulatedText,
        isComplete: true
      });

      const summaryContent = finalData.summary || "A moment of reflection.";
      const highlights: Highlight[] = Array.isArray(finalData.highlights) ? finalData.highlights : [];

      log.info('AI returned highlights from streaming', { count: highlights.length, highlights });

      // Note: Token usage extraction from streaming is complex and may not be available
      // in the current SDK version. We'll skip it for now.
      const tokenUsage: TokenUsage | undefined = undefined;
      log.debug('Skipping token usage extraction for streaming response');

      // Mood from reflection response (most accurate - AI understands full context)
      let reflectionMood: Mood | undefined;
      if (finalData.mood) {
        const rawMood = (finalData.mood || '').toLowerCase().trim();
        const validMoods: Mood[] = ['calm', 'joyful', 'anxious', 'tired', 'reflective', 'heavy', 'none'];
        if (validMoods.includes(rawMood as Mood)) {
          reflectionMood = rawMood as Mood;
          log.info('Mood from streaming reflection response', { mood: reflectionMood });
        } else {
          log.warn('Invalid mood from streaming reflection response', { mood: rawMood });
        }
      }

      // Use mood from reflection if available, otherwise use detected mood
      if (reflectionMood && reflectionMood !== 'none') {
        finalMood = reflectionMood;
        log.info('Using mood from streaming reflection response', { mood: finalMood });
      } else if (reflectionMood === 'none') {
        // AI explicitly said 'none', use it
        finalMood = 'none';
        log.debug('Mood from streaming reflection is none');
      } else {
        // No mood in reflection response, keep the detected mood
        log.debug('No mood in streaming reflection response, using detected mood', { detectedMood: finalMood });
      }

      // Topic from reflection response (most accurate - AI understands full context)
      let finalTopic: string | undefined = finalData.topic;

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
        log.debug('Topic from streaming reflection not available or too generic, using initial detection');
        finalTopic = detectedTopic;
      } else {
        log.info('Topic from streaming reflection response', { topic: finalTopic });
      }

      if (!finalTopic) {
        log.debug('No topic could be determined from streaming');
      }

      return {
        summary: summaryContent,
        topic: finalTopic,
        mood: finalMood,
        entities: currentEntities, // Return extracted entities to be saved with the entry
        highlights: highlights, // Return AI-detected highlights for UI emphasis
        tokenUsage: tokenUsage // Return token usage for cost transparency
      };
    } catch (error) {
      log.error('Gemini API error during streaming reflection generation', {}, error as Error);
      throw error;
    }
  }

  async generateEmbedding(text: string): Promise<number[]> {
    return this._generateEmbedding(text);
  }
}
