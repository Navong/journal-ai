import { HistoryEntry, Mood, ExtractedEntities, Highlight, ReflectionProgressCallback, TokenUsage } from "../types";
import logger from "../utils/logger";
import { getLLMProvider } from './providers/llm';
import { getTTSProvider } from './providers/tts';
import { ChatSession } from "./providers/llm/interface";

const log = logger.module('JournalAIService');

// Initialize providers
const llmProvider = getLLMProvider();
const ttsProvider = getTTSProvider();

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

// The TTS functions will delegate to the TTSProvider
export const generateSpeechStream = async (text: string): Promise<ReadableStream<Uint8Array> | undefined> => {
  return ttsProvider.generateSpeechStream(text);
};

// The old generateSpeech function (which handled caching and chunking) has been removed.
// Consumers should now use generateSpeechStream and handle caching/chunking if needed.