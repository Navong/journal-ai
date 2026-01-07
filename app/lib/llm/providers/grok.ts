// app/lib/llm/providers/grok.ts
import { OpenRouter } from "@openrouter/sdk";
import { GoogleGenAI } from "@google/genai";
import { HistoryEntry, Mood, ExtractedEntities, Highlight, ReflectionProgressCallback, TokenUsage } from "@/types";
import logger from "@/utils/logger";
import { extractEntities } from "@/utils/entityExtraction";
import { buildEntityContext, formatEntityContextForPrompt } from "@/lib/core/entity";
import { LLMProvider, ChatSession, StreamingCallback } from "../interface";
import * as constants from "../utils/constants";
import { estimateTokens } from "../utils/tokenUtils";
import { calculateRelevanceScore, getCachedEmbedding, setCachedEmbedding } from "../utils/embeddingUtils";
import { formatEntryForContext, reRankEntries, ContextEntry } from "../utils/contextUtils";

// System instruction for the AI companion (same as Gemini)
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

const log = logger.module('GrokLLMProvider');

const getApiKey = (): string => {
  return (typeof process !== 'undefined' && (process.env?.NEXT_PUBLIC_OPENROUTER_API_KEY || process.env?.OPENROUTER_API_KEY)) || '';
};

const getGeminiApiKey = (): string => {
  return (typeof process !== 'undefined' && (process.env?.NEXT_PUBLIC_GEMINI_API_KEY || process.env?.GEMINI_API_KEY)) || '';
};

// Model mapping - Grok 4.1 Fast
const GROK_MODEL = 'x-ai/grok-4.1-fast';

// Initialize OpenRouter SDK instance
const openrouter = new OpenRouter({
  apiKey: getApiKey()
});

// Initialize Gemini SDK for embeddings (shared across providers)
const geminiAi = new GoogleGenAI({ apiKey: getGeminiApiKey() });

// Adapter for OpenRouter streaming to implement ChatSession interface
class GrokChatSession implements ChatSession {
  private messages: Array<{role: "user" | "assistant" | "system", content: string}> = [];

  constructor(initialMessages: Array<{role: string, content: string}> = []) {
    this.messages = initialMessages.map(m => ({
      role: m.role as "user" | "assistant" | "system",
      content: m.content
    }));
  }

  async sendMessage(message: string): Promise<string> {
    this.messages.push({ role: 'user', content: message });

    try {
      // Stream the response to get reasoning tokens in usage
      const stream = await openrouter.chat.send({
        model: GROK_MODEL,
        messages: this.messages,
        stream: true,
        streamOptions: {
          includeUsage: true
        }
      });

      let response = "";
      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content;
        if (content) {
          response += content;
        }

        // Usage information comes in the final chunk
        if (chunk.usage) {
          log.debug("Usage details:", chunk.usage);
        }
      }

      // Add assistant response to message history
      this.messages.push({ role: 'assistant', content: response });
      return response;

    } catch (error) {
      log.error('Error sending message in Grok chat session', {}, error as Error);
      throw error;
    }
  }
}

export class GrokLLMProvider implements LLMProvider {
  private apiKey: string;

  constructor() {
    this.apiKey = getApiKey();
    if (!this.apiKey) {
      throw new Error('OPENROUTER_API_KEY is not configured. Please set OPENROUTER_API_KEY in your .env.local file');
    }
  }

  // Generate embedding using Gemini's native API (faster than OpenRouter)
  private async _generateEmbedding(text: string): Promise<number[]> {
    // Normalize text for cache key
    const cacheKey = text.trim().toLowerCase();

    // Check cache first
    const cached = getCachedEmbedding(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      // Use the pre-initialized geminiAi instance for speed
      // This avoided module re-import and re-initialization overhead
      const result = await geminiAi.models.embedContent({
        model: 'text-embedding-004',
        contents: [{ text: text.trim() }],
      });

      const embedding = result.embeddings?.[0]?.values;

      if (!embedding) {
        throw new Error('No embedding returned from Gemini API');
      }

      // Cache the embedding
      setCachedEmbedding(cacheKey, embedding);

      return embedding;
    } catch (error) {
      log.error('Error generating embedding with Gemini API', {}, error as Error);
      throw error;
    }
  }

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

    // STEP 1 & 2: Generate embeddings for current entry and history in parallel
    let currentEmbedding: number[] | null = null;
    let historyEmbeddings: (number[] | null)[] = [];

    try {
      const results = await Promise.all([
        (async () => {
          try {
            return await this._generateEmbedding(currentEntry);
          } catch (error) {
            log.warn('Failed to generate embedding for current entry', {}, error as Error);
            return null;
          }
        })(),
        ...history.map(async (entry) => {
          try {
            return await this._generateEmbedding(entry.text);
          } catch (error) {
            log.warn('Failed to generate embedding for entry', { entryId: entry.id });
            return null;
          }
        })
      ]);

      currentEmbedding = results[0] as number[] | null;
      historyEmbeddings = results.slice(1) as (number[] | null)[];
    } catch (error) {
      log.error('Parallel embedding generation failed', {}, error as Error);
    }

    // STEP 3: Calculate initial relevance scores
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
        tokens: 0 
      };
    });

    // STEP 4: Filter by minimum relevance threshold
    let filteredEntries = scoredEntries.filter(scored => {
      return scored.score >= constants.MIN_RELEVANCE_SCORE;
    });

    if (filteredEntries.length === 0) {
      const highestScoring = scoredEntries.sort((a, b) => b.score - a.score)[0];
      if (highestScoring) {
        filteredEntries.push(highestScoring);
      }
    }

    // STEP 5: Lightweight re-ranking
    filteredEntries.sort((a, b) => b.score - a.score);
    const topKEntries = filteredEntries.slice(0, constants.RE_RANK_TOP_K);
    const reRankedEntries = reRankEntries(topKEntries, currentTopic);

    reRankedEntries.sort((a, b) => b.score - a.score);

    // STEP 6: Select entries within token limit
    const entriesWithTokens = reRankedEntries.map(scored => ({
      ...scored,
      tokens: estimateTokens(
        formatEntryForContext(scored.entry, includeReflection, scored.score, scored.relevanceReasons)
      )
    }));

    const selected: ContextEntry[] = [];
    let totalTokens = 0;

    for (const scored of entriesWithTokens) {
      if (totalTokens + scored.tokens > maxTokens) {
        continue;
      }

      selected.push(scored);
      totalTokens += scored.tokens;
    }

    // Sort selected entries by date (most recent last)
    selected.sort((a, b) => {
      const dateA = new Date(a.entry.timestamp).getTime();
      const dateB = new Date(b.entry.timestamp).getTime();
      return dateA - dateB;
    });

    const contextParts = selected.map(scored =>
      formatEntryForContext(scored.entry, includeReflection, scored.score, scored.relevanceReasons)
    );
    return contextParts.join('\n\n---\n\n');
  }

  async detectMood(entry: string): Promise<Mood> {
    const entryLength = entry.trim().length;
    if (!entry.trim() || entryLength < 15) {
      return 'none';
    }

    const moodDetectionPrompt = `Analyze this journal entry and identify the emotional mood or state.

Available moods: "calm", "joyful", "anxious", "tired", "reflective", "heavy", "none".

Journal entry:
"${entry.trim()}"

Respond in JSON format: {"mood": "your_selected_mood"}`;

    try {
      const response = await openrouter.chat.send({
        model: GROK_MODEL,
        messages: [{ role: 'user', content: moodDetectionPrompt }],
        responseFormat: { type: 'json_object' }
      });

      const responseText = response.choices?.[0]?.message?.content as string || '';
      const moodData = JSON.parse(responseText);
      const rawMood = (moodData.mood || '').toLowerCase().trim();

      const validMoods: Mood[] = ['calm', 'joyful', 'anxious', 'tired', 'reflective', 'heavy', 'none'];
      return validMoods.includes(rawMood as Mood) ? (rawMood as Mood) : 'none';
    } catch (error) {
      log.error('Mood detection error', {}, error as Error);
      return 'none';
    }
  }

  async detectTopic(entry: string): Promise<string | undefined> {
    const entryLength = entry.trim().length;
    if (!entry.trim() || entryLength < 15) {
      return undefined;
    }

    const topicDetectionPrompt = `Analyze this journal entry and identify the main topic or theme (1-3 words).
Focus on WHAT the person is writing about.

Journal entry:
"${entry.trim()}"

Respond in JSON format: {"topic": "your_selected_topic"}`;

    try {
      const response = await openrouter.chat.send({
        model: GROK_MODEL,
        messages: [{ role: 'user', content: topicDetectionPrompt }],
        responseFormat: { type: 'json_object' }
      });

      const responseText = response.choices?.[0]?.message?.content as string || '{}';
      const topicData = JSON.parse(responseText);
      const detectedTopic = (topicData.topic || '').trim();

      if (!detectedTopic || detectedTopic.toLowerCase() === 'general' || detectedTopic.toLowerCase() === 'none') {
        return undefined;
      }

      return detectedTopic.split(/\s+/).map((word: string) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
    } catch (error) {
      log.error('Topic detection error', {}, error as Error);
      return undefined;
    }
  }

  async getJournalReflection(
    entry: string,
    mood: string,
    history: HistoryEntry[],
    onProgress?: ReflectionProgressCallback
  ): Promise<{ reflection: string; summary: string; topic?: string; mood?: Mood; entities?: ExtractedEntities; highlights?: Highlight[]; tokenUsage?: TokenUsage }> {
    const startTime = Date.now();
    log.info('Starting Grok reflection generation');

    onProgress?.({ stage: 'extracting_entities', message: 'Analyzing entry...' });
    
    // Parallelize entity extraction, mood detection, and topic detection
    let currentEntities: ExtractedEntities | undefined;
    let finalMood: Mood = 'none';
    let detectedTopic: string | undefined;
    
    try {
      [currentEntities, finalMood, detectedTopic] = await Promise.all([
        (async () => {
          try {
            return await extractEntities(entry);
          } catch (error) {
            log.error('Entity extraction failed', {}, error as Error);
            return undefined;
          }
        })(),
        (async () => {
          try {
            return await this.detectMood(entry);
          } catch (error) {
            log.error('Mood detection failed', {}, error as Error);
            return 'none' as Mood;
          }
        })(),
        (async () => {
          try {
            return await this.detectTopic(entry);
          } catch (error) {
            log.error('Topic detection failed', {}, error as Error);
            return undefined;
          }
        })()
      ]);
    } catch (error) {
      log.error('Parallel analysis failed', {}, error as Error);
      // Fallback to sequential processing
      try {
        currentEntities = await extractEntities(entry);
      } catch (e) {
        log.error('Entity extraction failed in fallback', {}, e as Error);
      }
      try {
        finalMood = await this.detectMood(entry);
      } catch (e) {
        log.error('Mood detection failed in fallback', {}, e as Error);
        finalMood = 'none';
      }
      try {
        detectedTopic = await this.detectTopic(entry);
      } catch (e) {
        log.error('Topic detection failed in fallback', {}, e as Error);
      }
    }

    onProgress?.({ stage: 'building_context', message: 'Searching memories...' });
    const entityContext = buildEntityContext(history, 3);
    const entityContextPrompt = formatEntityContextForPrompt(entityContext);

    const historyContext = await this._selectRelevantContext(
      entry,
      finalMood,
      detectedTopic,
      history,
      constants.MAX_CONTEXT_TOKENS_REFLECTION,
      true
    );

    const prompt = `
### ENTITY CONTEXT
${entityContextPrompt}

### USER CONTEXT
${historyContext}

### CURRENT ENTRY
Content: "${entry}"

Please provide your reflection and a concise summary.
Also identify main topic, emotional mood, and key phrases to highlight (Main Idea, Somatic Stressor, Identity Win).
Respond in JSON format with fields: "reflection", "summary", "topic", "mood", "highlights".
`;

    onProgress?.({ stage: 'generating_reflection', message: 'Crafting reflection...' });
    const analysisDuration = Date.now() - startTime;
    log.info('Analysis phase complete (Grok)', { durationMs: analysisDuration });

    const llmStartTime = Date.now();
    try {
      const response = await openrouter.chat.send({
        model: GROK_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_INSTRUCTION },
          { role: 'user', content: prompt }
        ],
        responseFormat: { type: 'json_object' }
      });

      const llmDuration = Date.now() - llmStartTime;
      const totalDuration = Date.now() - startTime;
      log.info('LLM generation complete (Grok)', { 
        durationMs: llmDuration, 
        totalDurationMs: totalDuration 
      });

      const responseText = response.choices?.[0]?.message?.content as string || '{}';
      const result = JSON.parse(responseText);
      
      const tokenUsage: TokenUsage | undefined = response.usage ? {
        promptTokens: response.usage.promptTokens,
        completionTokens: response.usage.completionTokens,
        reasoningTokens: (response.usage as any).reasoningTokens,
        totalTokens: response.usage.totalTokens
      } : undefined;

      return {
        reflection: result.reflection || "I appreciate you sharing your thoughts.",
        summary: result.summary || "A moment of reflection.",
        topic: result.topic || detectedTopic,
        mood: result.mood || finalMood,
        entities: currentEntities,
        highlights: result.highlights || [],
        tokenUsage
      };
    } catch (error) {
      log.error('Grok API error during reflection', {}, error as Error);
      throw error;
    }
  }

  async getJournalReflectionStream(
    entry: string,
    mood: string,
    history: HistoryEntry[],
    onChunk: StreamingCallback,
    onProgress?: ReflectionProgressCallback
  ): Promise<{ summary: string; topic?: string; mood?: Mood; entities?: ExtractedEntities; highlights?: Highlight[]; tokenUsage?: TokenUsage }> {
    const startTime = Date.now();
    log.info('Starting Grok streaming reflection generation');

    // For streaming, we use the SDK's streaming capability
    onProgress?.({ stage: 'extracting_entities', message: 'Analyzing entry...' });
    
    // Parallelize entity extraction, mood detection, and topic detection
    let currentEntities: ExtractedEntities | undefined;
    let finalMood: Mood = 'none';
    let detectedTopic: string | undefined;
    
    try {
      [currentEntities, finalMood, detectedTopic] = await Promise.all([
        (async () => {
          try {
            return await extractEntities(entry);
          } catch (error) {
            log.error('Entity extraction failed', {}, error as Error);
            return undefined;
          }
        })(),
        (async () => {
          try {
            return await this.detectMood(entry);
          } catch (error) {
            log.error('Mood detection failed', {}, error as Error);
            return 'none' as Mood;
          }
        })(),
        (async () => {
          try {
            return await this.detectTopic(entry);
          } catch (error) {
            log.error('Topic detection failed', {}, error as Error);
            return undefined;
          }
        })()
      ]);
    } catch (error) {
      log.error('Parallel analysis failed in stream', {}, error as Error);
      // Fallback to sequential processing
      try {
        currentEntities = await extractEntities(entry);
      } catch (e) {
        log.error('Entity extraction failed in fallback', {}, e as Error);
      }
      try {
        finalMood = await this.detectMood(entry);
      } catch (e) {
        log.error('Mood detection failed in fallback', {}, e as Error);
        finalMood = 'none';
      }
      try {
        detectedTopic = await this.detectTopic(entry);
      } catch (e) {
        log.error('Topic detection failed in fallback', {}, e as Error);
      }
    }

    const entityContext = buildEntityContext(history, 3);
    const entityContextPrompt = formatEntityContextForPrompt(entityContext);

    const historyContext = await this._selectRelevantContext(
      entry,
      finalMood,
      detectedTopic,
      history,
      constants.MAX_CONTEXT_TOKENS_REFLECTION,
      true
    );

    const prompt = `
### ENTITY CONTEXT
${entityContextPrompt}

### USER CONTEXT
${historyContext}

### CURRENT ENTRY
Content: "${entry}"

Please provide your reflection and a concise summary.
Identify topic, mood, and highlight key phrases.
IMPORTANT: Respond ONLY with a JSON object.
`;

    onProgress?.({ stage: 'generating_reflection', message: 'Crafting reflection...' });
    const analysisDuration = Date.now() - startTime;
    log.info('Analysis phase complete (Grok Stream)', { durationMs: analysisDuration });

    const llmStartTime = Date.now();
    try {
      const stream = await openrouter.chat.send({
        model: GROK_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_INSTRUCTION },
          { role: 'user', content: prompt }
        ],
        stream: true,
        streamOptions: { includeUsage: true }
      });

      let fullResponse = "";
      let tokenUsage: TokenUsage | undefined;

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content;
        if (content) {
          fullResponse += content;
        }
        if (chunk.usage) {
          tokenUsage = {
            promptTokens: chunk.usage.promptTokens,
            completionTokens: chunk.usage.completionTokens,
            reasoningTokens: (chunk.usage as any).reasoningTokens,
            totalTokens: chunk.usage.totalTokens
          };
        }
      }

      const result = JSON.parse(fullResponse);
      const reflection = result.reflection || "";

      // Stream the reflection back to UI
      const CHUNK_SIZE = 5;
      for (let i = 0; i < reflection.length; i += CHUNK_SIZE) {
        onChunk({
          text: reflection.substring(i, i + CHUNK_SIZE),
          isComplete: false
        });
        await new Promise(resolve => setTimeout(resolve, 20));
      }

      const llmDuration = Date.now() - llmStartTime;
      const totalDuration = Date.now() - startTime;
      log.info('LLM generation complete (Grok Stream)', { 
        durationMs: llmDuration, 
        totalDurationMs: totalDuration 
      });

      onChunk({ text: "", isComplete: true });

      return {
        summary: result.summary || "",
        topic: result.topic || detectedTopic,
        mood: result.mood || finalMood,
        entities: currentEntities,
        highlights: result.highlights || [],
        tokenUsage
      };
    } catch (error) {
      log.error('Grok streaming error', {}, error as Error);
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
    const entityContext = buildEntityContext(history, 3);
    const entityContextPrompt = formatEntityContextForPrompt(entityContext);

    const historyContext = await this._selectRelevantContext(
      entry,
      mood as Mood,
      currentTopic,
      history,
      constants.MAX_CONTEXT_TOKENS_CHAT,
      false
    );

    const systemMessage = `${SYSTEM_INSTRUCTION}

CONTEXT:
Entity Context: ${entityContextPrompt}
Journal Entry: ${entry}
Mood: ${mood}
Initial Reflection: ${initialReflection}
Past Context: ${historyContext}
`;

    return new GrokChatSession([
      { role: 'system', content: systemMessage }
    ]);
  }

  async generateEmbedding(text: string): Promise<number[]> {
    return this._generateEmbedding(text);
  }
}
