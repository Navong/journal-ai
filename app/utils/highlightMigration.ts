// Highlight migration utility
// Extracts highlights from existing reflection text using Gemini AI
// This is for migrating old entries that don't have highlights

import { GoogleGenAI, Type } from "@google/genai";
import { Highlight, HighlightType } from "../types";
import logger from "./logger";

const log = logger.module('HighlightMigration');

const getApiKey = (): string => {
  return process.env.NEXT_PUBLIC_GEMINI_API_KEY || process.env.GEMINI_API_KEY || '';
};

/**
 * Extract highlights from existing reflection text
 * This is a lighter-weight operation than full reflection generation
 * since we only need to identify key phrases in existing text
 */
export async function extractHighlightsFromReflection(reflectionText: string): Promise<Highlight[]> {
  const apiKey = getApiKey();
  if (!apiKey) {
    log.warn('No API key available for highlight extraction');
    return [];
  }

  if (!reflectionText.trim() || reflectionText.trim().length < 50) {
    log.debug('Reflection text too short for highlight extraction', { length: reflectionText.trim().length });
    return [];
  }

  try {
    const ai = new GoogleGenAI({ apiKey });

    const prompt = `Analyze this journal reflection text and identify key phrases (2-5 words each) that should be visually highlighted for the reader.

**Categories:**
1. **main_idea** (PURPLE highlights): The core insight or central theme - the key takeaway or most important point
   - Examples: "embrace the uncertainty", "growth through discomfort", "self-compassion matters"
   - Maximum 1-2 main_idea highlights per reflection
   
2. **somatic_stressor** (RED highlights): Physical symptoms, body sensations, OR external stressors like people causing stress, deadlines, obligations
   - Examples: "chest tightening", "couldn't sleep", "Sarah's deadline", "overwhelming workload"
   
3. **identity_win** (GOLD highlights): Achievements, moments of agency/voice, emotional victories, self-compassion
   - Examples: "stood up for myself", "completed the project", "chose to rest", "proud of progress"

**Guidelines:**
- Extract EXACT phrases that appear in the text (2-5 words)
- Maximum 5-7 highlights total (don't over-highlight)
- Always try to identify at least 1 main_idea if possible
- Focus on the most impactful phrases
- Only highlight phrases that genuinely fit the categories
- If there's nothing meaningful to highlight, return empty array

**Reflection text:**
"${reflectionText.trim()}"

Extract highlights:`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: prompt,
      config: {
        temperature: 0.3,
        maxOutputTokens: 400,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            highlights: {
              type: Type.ARRAY,
              description: "Key phrases to highlight from the reflection text",
              items: {
                type: Type.OBJECT,
                properties: {
                  text: {
                    type: Type.STRING,
                    description: "The exact phrase to highlight (must appear in reflection text)"
                  },
                  type: {
                    type: Type.STRING,
                    description: "Category: main_idea (core insight, 1-2 max), somatic_stressor (physical/external stress), or identity_win (achievements/agency)"
                  }
                },
                required: ["text", "type"]
              }
            }
          },
          required: ["highlights"]
        }
      }
    });

    const data = JSON.parse(response.text || '{}');
    const highlights: Highlight[] = Array.isArray(data.highlights) 
      ? data.highlights
          .filter((h: any) => h && h.text && h.type)
          .filter((h: any) => ['main_idea', 'somatic_stressor', 'identity_win'].includes(h.type))
          .filter((h: any) => {
            // Verify the phrase actually exists in the reflection text (case-insensitive)
            const textLower = reflectionText.toLowerCase();
            const phraseLower = h.text.toLowerCase();
            return textLower.includes(phraseLower);
          })
          .map((h: any) => ({
            text: h.text,
            type: h.type as HighlightType
          }))
      : [];

    log.info('Highlights extracted from reflection', { count: highlights.length });
    return highlights;
  } catch (error) {
    log.error('Failed to extract highlights from reflection', {}, error as Error);
    return [];
  }
}

export interface MigrationProgress {
  total: number;
  processed: number;
  updated: number;
  skipped: number;
  errors: number;
  currentEntry?: string;
}

export interface MigrationResult {
  success: boolean;
  total: number;
  updated: number;
  skipped: number;
  errors: number;
  errorDetails: string[];
}
