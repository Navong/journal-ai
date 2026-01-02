
export type Mood = 'calm' | 'joyful' | 'anxious' | 'tired' | 'reflective' | 'heavy' | 'none';

export interface Event {
  name: string;
  date?: string;           // ISO date string if mentioned
  deadline?: boolean;      // Is this a deadline/urgent event?
  description?: string;    // Brief context
}

export interface ExtractedEntities {
  people: string[];        // Names of people mentioned
  places: string[];        // Locations, cities, venues
  events: Event[];         // Events with optional dates/deadlines
  organizations: string[]; // Companies, schools, groups
}

export interface Reflection {
  content: string;
  summary: string;
  timestamp: Date;
  topic?: string; // Detected topic of the journal entry
}

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
  audioBase64?: string | string[]; // Support both single audio and chunked audio arrays
}

export interface AudioPlaybackState {
  isPlaying: boolean;
  isPaused: boolean;
  playbackRate: number;
  currentTime: number;
  duration: number;
}

export interface HistoryEntry {
  id: string;
  text: string;
  summary?: string;
  reflection: string;
  mood: Mood;
  topic?: string; // Detected topic/tag for the journal entry
  timestamp: string;
  chatHistory?: ChatMessage[];
  audioBase64?: string | string[]; // Store audio for history entries
  entities?: ExtractedEntities; // Extracted entities (people, places, events, organizations)
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
