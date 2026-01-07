// app/services/providers/tts/murf-mood-mapping.ts
import type { Mood } from '@/types';

/**
 * Murf AI Voice Styles for Emotional Expression
 *
 * Murf Gen2 supports various speaking styles that can convey different emotions.
 * This mapping selects the most appropriate style based on detected journal mood.
 *
 * Available Murf Styles:
 * - Calm: Soothing, peaceful, relaxed delivery
 * - Conversational: Natural, friendly, empathetic tone
 * - Inspirational: Uplifting, motivating, encouraging
 * - Angry: Strong, intense emotion (use sparingly)
 * - Sad: Gentle, sympathetic, somber
 * - Excited: Energetic, enthusiastic, joyful
 * - Friendly: Warm, approachable, supportive
 * - Professional: Neutral, clear, authoritative
 * - Storytelling: Engaging, expressive, narrative
 */

export type MurfStyle =
  | 'Calm'
  | 'Conversational'
  | 'Inspirational'
  | 'Sad'
  | 'Excited'
  | 'Friendly'
  | 'Professional'
  | 'Storytelling';

/**
 * Maps journal mood to appropriate Murf voice style
 *
 * Mapping strategy:
 * - calm → Calm (peaceful, soothing)
 * - joyful → Inspirational (uplifting, celebratory)
 * - anxious → Conversational (gentle, supportive, not overwhelming)
 * - tired → Calm (restful, gentle)
 * - reflective → Storytelling (thoughtful, narrative)
 * - heavy → Friendly (warm, empathetic, supportive)
 * - none → Conversational (neutral default)
 */
export function moodToMurfStyle(mood: Mood): MurfStyle {
  switch (mood) {
    case 'calm':
      return 'Calm';
    case 'joyful':
      return 'Inspirational';
    case 'anxious':
      return 'Conversational'; // Gentle, not harsh
    case 'tired':
      return 'Calm'; // Soothing for rest
    case 'reflective':
      return 'Storytelling'; // Thoughtful, narrative
    case 'heavy':
      return 'Friendly'; // Warm, empathetic support
    case 'none':
    default:
      return 'Conversational'; // Safe default
  }
}

/**
 * Get a human-readable description of why a style was chosen
 */
export function getMurfStyleRationale(mood: Mood): string {
  switch (mood) {
    case 'calm':
      return 'Using Calm style for peaceful, soothing delivery';
    case 'joyful':
      return 'Using Inspirational style for uplifting, celebratory tone';
    case 'anxious':
      return 'Using Conversational style for gentle, supportive presence';
    case 'tired':
      return 'Using Calm style for restful, gentle comfort';
    case 'reflective':
      return 'Using Storytelling style for thoughtful, narrative flow';
    case 'heavy':
      return 'Using Friendly style for warm, empathetic support';
    case 'none':
    default:
      return 'Using Conversational style as neutral default';
  }
}
