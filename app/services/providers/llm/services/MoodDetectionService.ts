import { GoogleGenAI, Type } from "@google/genai";
import { Mood } from "@/app/types";
import * as constants from "../utils/constants";
import logger from "@/app/utils/logger";

const log = logger.module('MoodDetectionService');

export class MoodDetectionService {
  constructor(private ai: GoogleGenAI) {}

  async detectMood(entry: string): Promise<Mood> {
    const entryLength = entry.trim().length;
    log.debug('Mood detection called', { entryLength });

    if (!entry.trim() || entryLength < 15) {
      log.debug('Entry too short for mood detection, defaulting to none', { entryLength });
      return 'none'; // Need minimum text to detect mood
    }

    log.debug('Starting mood detection');
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
      const response = await this.ai.models.generateContent({
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
}
