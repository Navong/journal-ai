import { GoogleGenAI, Type } from "@google/genai";
import { ExtractedEntities } from "../types";
import logger from "./logger";
import { withGeminiRetry } from "./geminiRetry";
import { getGeminiModel } from "./geminiModel";

const log = logger.module('EntityExtraction');

const getApiKey = (): string => {
  return process.env.NEXT_PUBLIC_GEMINI_API_KEY || process.env.GEMINI_API_KEY || '';
};

function normalizeTopicFromModel(detectedTopic: string | undefined): string | undefined {
  if (!detectedTopic?.trim()) return undefined;
  const cleanedTopic = detectedTopic
    .replace(/^["']|["']$/g, '')
    .replace(/^topic\s*[:\-]\s*/i, '')
    .split(/[,;.\n]/)[0]
    .split(/\s+/)
    .slice(0, 3)
    .join(' ')
    .trim()
    .toLowerCase();
  if (!cleanedTopic || cleanedTopic === 'none' || cleanedTopic === 'general') {
    return undefined;
  }
  return cleanedTopic
    .split(/\s+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Single Gemini call: entities + main topic (1 LLM round-trip for reflection prep).
 */
export async function extractEntitiesAndTopic(
  text: string
): Promise<{ entities: ExtractedEntities; topic: string | undefined }> {
  const empty = { entities: { people: [], places: [], events: [], organizations: [] } as ExtractedEntities, topic: undefined as string | undefined };
  const apiKey = getApiKey();
  if (!apiKey) {
    log.warn('No API key available for entity extraction');
    return empty;
  }

  const trimmed = text.trim();
  if (!trimmed || trimmed.length < 15) {
    log.debug('Text too short for entity+topic extraction', { length: trimmed.length });
    return empty;
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const model = getGeminiModel();

    const prompt = `Extract specific entities from this journal entry AND identify the main topic or theme.

**Entities — extract only what is explicitly mentioned:**
1. **People**: Names (not pronouns). Include Mom, Dad, Sister, etc.
2. **Places**: Cities, venues, office, home, gym, etc.
3. **Events**: Meetings, deadlines, dates. Mark deadline/urgent when clear.
4. **Organizations**: Companies, schools, teams, groups.

**Topic (separate field):**
- WHAT they are writing about (subject matter), not mood.
- 1–3 words, specific (e.g. "work stress", "family conflict").
- If vague, use "general" or leave topic empty.

Journal entry:
"${trimmed}"`;

    const response = await withGeminiRetry(() =>
      ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          temperature: 0.3,
          maxOutputTokens: 500,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              people: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "Names of people mentioned (first names or full names, family titles like Mom/Dad)",
              },
              places: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "Specific locations mentioned (cities, buildings, venues, neighborhoods)",
              },
              events: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING, description: "Name of the event/meeting/deadline" },
                    date: { type: Type.STRING, description: "Approximate date if mentioned" },
                    deadline: { type: Type.BOOLEAN, description: "True if deadline or urgent" },
                    description: { type: Type.STRING, description: "Brief context" },
                  },
                  required: ["name"],
                },
                description: "Events, meetings, appointments, deadlines mentioned",
              },
              organizations: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "Companies, schools, teams, groups, clubs mentioned",
              },
              topic: {
                type: Type.STRING,
                description: "Main topic or theme, 1-3 words; empty or 'general' if unclear",
              },
            },
            required: ["people", "places", "events", "organizations"],
          },
        },
      })
    );

    // Clean and parse the response text
    let responseText = response.text || '{}';
    
    // Remove markdown code blocks if present (some models wrap JSON in ```json ... ```)
    responseText = responseText.trim();
    if (responseText.startsWith('```')) {
      // Remove opening ```json or ```
      responseText = responseText.replace(/^```(?:json)?\s*/i, '');
      // Remove closing ```
      responseText = responseText.replace(/\s*```$/i, '');
      responseText = responseText.trim();
    }
    
    // Try to extract JSON from text if it's embedded in other text
    // Look for JSON object pattern { ... }
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch && jsonMatch[0] !== responseText) {
      log.debug('Extracted JSON from response text', { 
        originalLength: responseText.length,
        extractedLength: jsonMatch[0].length 
      });
      responseText = jsonMatch[0];
    }
    
    // Validate response text before parsing
    if (!responseText || responseText === '{}' || !responseText.trim().startsWith('{')) {
      log.warn('Empty or invalid response from entity extraction API', { 
        responseLength: responseText.length,
        preview: responseText.substring(0, 100)
      });
      return empty;
    }

    let data: any;
    try {
      data = JSON.parse(responseText);
    } catch (parseError) {
      log.error(
        'Failed to parse JSON response',
        {
          responseText: responseText.substring(0, 500),
          responseLength: responseText.length,
          error: parseError instanceof Error ? parseError.message : String(parseError),
        },
        parseError as Error
      );
      return empty;
    }

    if (!data || typeof data !== 'object') {
      log.warn('Invalid data structure from entity extraction', { data });
      return empty;
    }
    
    const entities: ExtractedEntities = {
      people: Array.isArray(data.people) ? data.people.filter((p: string) => p && p.trim()) : [],
      places: Array.isArray(data.places) ? data.places.filter((p: string) => p && p.trim()) : [],
      events: Array.isArray(data.events) ? data.events.filter((e: any) => e && e.name) : [],
      organizations: Array.isArray(data.organizations) ? data.organizations.filter((o: string) => o && o.trim()) : [],
    };

    const topic = normalizeTopicFromModel(typeof data.topic === 'string' ? data.topic : undefined);

    log.info('Entities + topic extracted', {
      people: entities.people.length,
      places: entities.places.length,
      events: entities.events.length,
      organizations: entities.organizations.length,
      topic,
    });

    return { entities, topic };
  } catch (error) {
    log.error('Entity+topic extraction failed', {}, error as Error);
    return empty;
  }
}

/**
 * Extract entities (people, places, events, organizations) from journal text
 * Uses Gemini AI with structured output for reliable extraction
 */
export async function extractEntities(text: string): Promise<ExtractedEntities> {
  const { entities } = await extractEntitiesAndTopic(text);
  return entities;
}
