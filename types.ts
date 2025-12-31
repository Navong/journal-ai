
export type Mood = 'calm' | 'joyful' | 'anxious' | 'tired' | 'reflective' | 'heavy' | 'none';

export interface Reflection {
  content: string;
  summary: string;
  timestamp: Date;
}

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
  audioBase64?: string;
}

export interface HistoryEntry {
  id: string;
  text: string;
  summary?: string;
  reflection: string;
  mood: Mood;
  timestamp: string;
  chatHistory?: ChatMessage[];
}

export enum AppStatus {
  IDLE = 'IDLE',
  LOADING = 'LOADING',
  SUCCESS = 'SUCCESS',
  ERROR = 'ERROR'
}

export enum ViewMode {
  JOURNAL = 'JOURNAL',
  HISTORY = 'HISTORY'
}
