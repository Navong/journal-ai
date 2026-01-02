import { GoogleGenAI, Type } from "@google/genai";
import { ExtractedEntities } from "../types";
import logger from "./logger";

const log = logger.module('EntityExtraction');

const getApiKey = (): string => {
  return process.env.NEXT_PUBLIC_GEMINI_API_KEY || process.env.GEMINI_API_KEY || '';
};

/**
 * Extract entities (people, places, events, organizations) from journal text
 * Uses Gemini AI with structured output for reliable extraction
 */
export async function extractEntities(text: string): Promise<ExtractedEntities> {
  const apiKey = getApiKey();
  if (!apiKey) {
    log.warn('No API key available for entity extraction');
    return { people: [], places: [], events: [], organizations: [] };
  }

  if (!text.trim() || text.trim().length < 20) {
    log.debug('Text too short for entity extraction', { length: text.trim().length });
    return { people: [], places: [], events: [], organizations: [] };
  }

  try {
    const ai = new GoogleGenAI({ apiKey });

    const prompt = `Extract specific entities from this journal entry. Be precise and only extract explicitly mentioned entities.

**Extract:**
1. **People**: Names of people mentioned (first names or full names). Do NOT extract pronouns like "he", "she", "they". Include family references like "Mom", "Dad", "Sister" if mentioned.
2. **Places**: Specific locations (cities, venues, buildings, restaurants, etc.). Include "office", "home", "gym", specific neighborhoods. Be specific.
3. **Events**: Meetings, appointments, deadlines, important dates. Extract the event name and date if mentioned. Mark if it's a deadline or urgent.
4. **Organizations**: Companies, schools, teams, groups, clubs.

**Guidelines:**
- Only extract entities that are explicitly mentioned in the text
- For events, identify if it's a deadline/urgent by context (words like "deadline", "due", "urgent", "must finish")
- For events with dates, try to extract approximate date (look for "on Monday", "next Friday", "December 15", "tomorrow", "next week", etc.)
- Normalize names (e.g., "mom" -> "Mom", "dr. smith" -> "Dr. Smith")
- Be conservative - don't over-extract or make assumptions
- Skip generic pronouns and vague references

Journal entry:
"${text.trim()}"

Extract entities:`;

    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: {
        temperature: 0.3, // Low temperature for consistent extraction
        maxOutputTokens: 500,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            people: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "Names of people mentioned (first names or full names, family titles like Mom/Dad)"
            },
            places: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "Specific locations mentioned (cities, buildings, venues, neighborhoods)"
            },
            events: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { 
                    type: Type.STRING, 
                    description: "Name of the event/meeting/deadline" 
                  },
                  date: { 
                    type: Type.STRING, 
                    description: "Approximate date if mentioned (ISO format preferred, or relative like 'next Friday')" 
                  },
                  deadline: { 
                    type: Type.BOOLEAN, 
                    description: "True if this is a deadline or urgent event" 
                  },
                  description: { 
                    type: Type.STRING, 
                    description: "Brief context or additional details" 
                  }
                },
                required: ["name"]
              },
              description: "Events, meetings, appointments, deadlines mentioned"
            },
            organizations: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "Companies, schools, teams, groups, clubs mentioned"
            }
          },
          required: ["people", "places", "events", "organizations"]
        }
      }
    });

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
      return { people: [], places: [], events: [], organizations: [] };
    }
    
    let data: any;
    try {
      data = JSON.parse(responseText);
    } catch (parseError) {
      log.error('Failed to parse JSON response', { 
        responseText: responseText.substring(0, 500), // Log first 500 chars for debugging
        responseLength: responseText.length,
        error: parseError instanceof Error ? parseError.message : String(parseError)
      }, parseError as Error);
      return { people: [], places: [], events: [], organizations: [] };
    }
    
    // Validate data structure
    if (!data || typeof data !== 'object') {
      log.warn('Invalid data structure from entity extraction', { data });
      return { people: [], places: [], events: [], organizations: [] };
    }
    
    const entities: ExtractedEntities = {
      people: Array.isArray(data.people) ? data.people.filter((p: string) => p && p.trim()) : [],
      places: Array.isArray(data.places) ? data.places.filter((p: string) => p && p.trim()) : [],
      events: Array.isArray(data.events) ? data.events.filter((e: any) => e && e.name) : [],
      organizations: Array.isArray(data.organizations) ? data.organizations.filter((o: string) => o && o.trim()) : [],
    };

    log.info('Entities extracted successfully', {
      people: entities.people.length,
      places: entities.places.length,
      events: entities.events.length,
      organizations: entities.organizations.length
    });

    return entities;
  } catch (error) {
    log.error('Entity extraction failed', {}, error as Error);
    // Return empty entities on error, don't break the flow
    return { people: [], places: [], events: [], organizations: [] };
  }
}
