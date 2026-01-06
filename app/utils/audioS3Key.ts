/**
 * Client-side utility for generating S3 audio keys
 * Matches the server-side logic in /api/history/audio/route.ts
 */

import { hashTTSInput } from './textHash';

/**
 * Generate S3 key for audio storage
 * Must match server-side logic for consistency
 *
 * @param reflectionText - The reflection text that will be converted to speech
 * @param userId - User ID (hashed email)
 * @param voiceId - Optional voice ID (defaults to env variable)
 * @returns S3 key in format: audio/{userId}/{hash}.wav
 */
export function generateAudioS3Key(
  reflectionText: string,
  userId: string,
  voiceId?: string
): string {
  // Use CARTESIA_VOICE_ID from environment or fallback to default
  // Note: On client-side, we need to use NEXT_PUBLIC_ prefix
  const defaultVoiceId = typeof window !== 'undefined'
    ? (window as any).__CARTESIA_VOICE_ID__ || '694f9389-aac1-45b6-b726-9d9369183238'
    : '694f9389-aac1-45b6-b726-9d9369183238';

  const voice = voiceId || defaultVoiceId;
  const textHash = hashTTSInput(reflectionText, voice);
  const s3Key = `audio/${userId}/${textHash}.wav`;

  return s3Key;
}
