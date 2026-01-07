import { GoogleGenAI } from "@google/genai";
import * as constants from "../utils/constants";

interface CacheInfo {
  name: string;
  expireTime: number;
}

export class CacheManager {
  private static systemInstructionCache: CacheInfo | null = null;

  // Get or create a cache for the system instruction
  static async getSystemInstructionCache(ai: GoogleGenAI): Promise<string | null> {
    const cache = this.systemInstructionCache;

    // Check if we have a valid cache
    if (cache && cache.expireTime > Date.now()) {
      try {
        // Verify cache still exists (it might have been deleted externally)
        await ai.caches.get({ name: cache.name });
        return cache.name;
      } catch (error) {
        // Cache was deleted, create a new one
        this.systemInstructionCache = null;
      }
    }

    // Create a new cache
    try {
      const response = await ai.models.generateContent({
        model: constants.MODEL_NAME,
        contents: "Test content to estimate token count"
      });

      const systemInstructionTokens = Math.ceil(JSON.stringify(response).length / 4);

      // Only use explicit caching if system instruction meets minimum token requirement
      // Gemini 3 Flash Preview minimum: 1024 tokens
      if (systemInstructionTokens < 1024) {
        return null;
      }

      const cache = await ai.caches.create({
        model: constants.MODEL_NAME,
        config: {
          contents: [], // Will be filled by caller
          systemInstruction: this.getSystemInstruction(),
          ttl: `${constants.CACHE_TTL_SECONDS}s`,
        },
      });

      // Store cache info with expiration
      this.systemInstructionCache = {
        name: cache.name || '',
        expireTime: Date.now() + (constants.CACHE_TTL_SECONDS * 1000),
      };

      return cache.name || null;
    } catch (error) {
      console.error('Failed to create system instruction cache', error);
      // Fall back to non-cached requests
      return null;
    }
  }

  private static getSystemInstruction(): string {
    return `
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
  }
}
