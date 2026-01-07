
import { HistoryEntry, ChatMessage, Mood, ExtractedEntities, Highlight, ReflectionProgressCallback, TokenUsage } from '@/app/types';

export interface StreamingChunk {
  text: string;
  isComplete: boolean;
}

export type StreamingCallback = (chunk: StreamingChunk) => void | Promise<void>;

export interface ChatSession {
  sendMessage(message: string): Promise<string>;
  // Define other methods if needed based on how the chat object is used.
}

export interface LLMProvider {
  detectMood(entry: string): Promise<Mood>;

  getJournalReflection(
    entry: string,
    mood: string,
    history: HistoryEntry[],
    onProgress?: ReflectionProgressCallback
  ): Promise<{
    reflection: string;
    summary: string;
    topic?: string;
    mood?: Mood;
    entities?: ExtractedEntities;
    highlights?: Highlight[];
    tokenUsage?: TokenUsage;
  }>;

  getJournalReflectionStream(
    entry: string,
    mood: string,
    history: HistoryEntry[],
    onChunk: StreamingCallback,
    onProgress?: ReflectionProgressCallback
  ): Promise<{
    summary: string;
    topic?: string;
    mood?: Mood;
    entities?: ExtractedEntities;
    highlights?: Highlight[];
    tokenUsage?: TokenUsage;
  }>;

  startJournalChat(
    entry: string,
    initialReflection: string,
    mood: string,
    history: HistoryEntry[],
    currentTopic?: string
  ): Promise<ChatSession>;

  detectTopic(entry: string): Promise<string | undefined>;

  generateEmbedding(text: string): Promise<number[]>;
}
