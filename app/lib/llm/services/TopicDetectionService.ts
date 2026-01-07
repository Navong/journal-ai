import { GoogleGenAI, Type } from "@google/genai";
import * as constants from "../utils/constants";
import logger from "@/utils/logger";

const log = logger.module('TopicDetectionService');

export class TopicDetectionService {
  constructor(private ai: GoogleGenAI) { }

  async detectTopic(entry: string): Promise<string | undefined> {
    const entryLength = entry.trim().length;
    log.debug('Topic detection called', { entryLength });

    if (!entry.trim() || entryLength < 15) {
      log.debug('Entry too short for topic detection', { entryLength });
      return undefined; // Need minimum text to detect topic
    }

    log.debug('Starting topic detection');

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
      const response = await this.ai.models.generateContent({
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
}
