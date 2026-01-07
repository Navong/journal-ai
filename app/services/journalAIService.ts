import { HistoryEntry, Mood, ExtractedEntities, Highlight, ReflectionProgressCallback, TokenUsage } from "../types";
import logger from "../utils/logger";
import { getLLMProvider } from './providers/llm';
import { ChatSession, StreamingCallback } from "./providers/llm/interface";

const log = logger.module('JournalAIService');

// Initialize providers
const llmProvider = getLLMProvider();

// The following functions will now delegate to the LLMProvider
export const detectMood = async (entry: string): Promise<Mood> => {
  return llmProvider.detectMood(entry);
};

export const getJournalReflection = async (
  entry: string,
  mood: string,
  history: HistoryEntry[],
  onProgress?: ReflectionProgressCallback
): Promise<{ reflection: string; summary: string; topic?: string; mood?: Mood; entities?: ExtractedEntities; highlights?: Highlight[]; tokenUsage?: TokenUsage }> => {
  return llmProvider.getJournalReflection(entry, mood, history, onProgress);
};

export const getJournalReflectionStream = async (
  entry: string,
  mood: string,
  history: HistoryEntry[],
  onChunk: StreamingCallback,
  onProgress?: ReflectionProgressCallback
): Promise<{ summary: string; topic?: string; mood?: Mood; entities?: ExtractedEntities; highlights?: Highlight[]; tokenUsage?: TokenUsage }> => {
  return llmProvider.getJournalReflectionStream(entry, mood, history, onChunk, onProgress);
};

export const startJournalChat = async (
  entry: string,
  initialReflection: string,
  mood: string,
  history: HistoryEntry[],
  currentTopic?: string
): Promise<ChatSession> => {
  return llmProvider.startJournalChat(entry, initialReflection, mood, history, currentTopic);
};

export const detectTopic = async (entry: string): Promise<string | undefined> => {
  return llmProvider.detectTopic(entry);
};

// The TTS function now delegates to the server-side API route
// Returns full Response object for AudioStreamPlayer
export const generateSpeechStream = async (text: string, entryId?: string, mood?: Mood): Promise<Response | undefined> => {
  try {
    const requestBody: { text: string; entryId?: string; mood?: Mood } = { text };
    if (entryId) {
      requestBody.entryId = entryId;
    }
    if (mood) {
      requestBody.mood = mood;
    }

    const response = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({ message: 'Failed to generate speech stream with no error body.' }));
      log.error('Failed to generate speech stream', { status: response.status, error: errorBody });
      throw new Error(errorBody.message || `HTTP error! status: ${response.status}`);
    }

    return response;
  } catch (error) {
    log.error('Error in generateSpeechStream fetch call', {}, error as Error);
    // Return undefined or re-throw, depending on desired error handling
    return undefined;
  }
};

// The old generateSpeech function (which handled caching and chunking) has been removed.
// Consumers should now use generateSpeechStream and handle caching/chunking if needed.
