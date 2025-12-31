
import { GoogleGenAI, Chat, Modality, Type } from "@google/genai";
import { HistoryEntry, ChatMessage } from "../types";

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

export const getJournalReflection = async (
  entry: string, 
  mood: string, 
  history: HistoryEntry[]
): Promise<{ reflection: string; summary: string }> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const recentHistory = history.slice(0, 5).reverse();
  const historyContext = recentHistory.length > 0 
    ? recentHistory.map(h => `[${new Date(h.timestamp).toLocaleDateString()}] Mood: ${h.mood}\nEntry: ${h.text}\nReflection: ${h.reflection}`).join('\n\n---\n\n')
    : "No previous history available.";

  const prompt = `
### USER CONTEXT (PAST ENTRIES)
${historyContext}

### CURRENT ENTRY
Mood: ${mood}
Content: "${entry}"

Please provide your reflection and a concise summary.
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
            summary: { type: Type.STRING, description: "A one-sentence summary of the entry's core theme." }
          },
          required: ["reflection", "summary"]
        }
      },
    });

    const data = JSON.parse(response.text || "{}");
    return {
      reflection: data.reflection || "I'm processing your thoughts. Thank you for sharing.",
      summary: data.summary || "A moment of reflection."
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
  history: HistoryEntry[]
): Chat => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const recentHistory = history.slice(0, 3).reverse();
  const historyContext = recentHistory.map(h => `[${new Date(h.timestamp).toLocaleDateString()}] Mood: ${h.mood}\nEntry: ${h.text}`).join('\n\n');

  return ai.chats.create({
    model: 'gemini-3-flash-preview',
    config: {
      systemInstruction: `${SYSTEM_INSTRUCTION}\n\nCONTEXT FOR THIS CONVERSATION:\nJournal Entry: ${entry}\nMood: ${mood}\nYour Initial Reflection: ${initialReflection}\n\nPast Context Summary:\n${historyContext}`,
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

export const generateSpeech = async (text: string): Promise<string | undefined> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const cleanedContent = cleanTextForTTS(text).slice(0, 1500);

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
    return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  } catch (error) {
    console.error("TTS Error:", error);
    return undefined;
  }
};
