
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

// Highlight types for semantic highlighting
// - somatic_stressor: Physical symptoms OR external pressures (red)
// - moment_of_agency: Moments of action/voice, NOT celebratory (gold)
// - main_idea: Core insight or central observation (emphasized)
export type HighlightType = 'somatic_stressor' | 'moment_of_agency' | 'main_idea';

// Legacy alias for backward compatibility
export type LegacyHighlightType = 'somatic_stressor' | 'identity_win' | 'main_idea';

export interface Highlight {
  text: string;           // The exact phrase to highlight
  type: HighlightType | 'identity_win';    // Category of highlight (identity_win for backward compat)
}

/**
 * MMA Reflection Structure (Mirror → Meaning → Anchor)
 * Each section serves a distinct purpose in the reflection
 */
export interface MMAReflection {
  mirror: string;         // What is happening - reflect emotions, name tensions
  meaning: string;        // What this feeling signals - orientation, not solutions
  anchor: string;         // Emotional stabilization - 1-2 sentences max
}

export interface Reflection {
  content: string;
  summary: string;
  timestamp: Date;
  topic?: string;         // Detected topic of the journal entry
  highlights?: Highlight[]; // AI-detected phrases to highlight
  mma?: MMAReflection;    // MMA sections if available
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
  highlights?: Highlight[]; // AI-detected phrases to highlight in reflection text
  mma?: MMAReflection; // MMA sections (mirror, meaning, anchor) if available
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
