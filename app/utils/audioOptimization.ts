// utils/audioOptimization.ts
// Audio optimization utilities for Serenity Journal

/**
 * Optimizes audio data for storage and playback
 * Currently a placeholder that returns the original audio
 * In the future, this could implement compression or format conversion
 */
export async function optimizeAudio(audioData: string): Promise<string> {
  // For now, return the original audio data
  // In the future, this could:
  // - Convert to a more efficient format
  // - Apply compression
  // - Reduce bitrate for smaller file sizes
  // - Optimize for specific playback scenarios
  
  // Validate input
  if (!audioData || typeof audioData !== 'string') {
    throw new Error('Audio data must be a non-empty string');
  }

  // Basic validation - check if it looks like base64
  const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
  if (!base64Regex.test(audioData.replace(/\s/g, ''))) {
    throw new Error('Audio data is not valid base64');
  }

  // For now, just return the original data
  // Future implementations could add actual optimization
  return audioData;
}

/**
 * Validates audio data format and length
 */
export function validateAudioData(audioData: string): boolean {
  if (!audioData || typeof audioData !== 'string') {
    return false;
  }

  // Check if it's valid base64
  const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
  if (!base64Regex.test(audioData.replace(/\s/g, ''))) {
    return false;
  }

  // Check minimum length (audio data should be at least 1000 chars base64 = ~750 bytes)
  const MIN_AUDIO_LENGTH = 1000;
  if (audioData.length < MIN_AUDIO_LENGTH) {
    return false;
  }

  return true;
}

/**
 * Gets the approximate file size in bytes from base64 audio data
 */
export function getAudioSize(audioData: string): number {
  if (!audioData) return 0;
  
  // Base64 encoded data is about 33% larger than original
  // So original size is roughly: (base64_length * 3) / 4
  return Math.round((audioData.length * 3) / 4);
}

/**
 * Gets the approximate duration in seconds (assuming 44.1kHz, 16-bit stereo)
 * This is a rough estimate and may not be accurate for all audio formats
 */
export function estimateAudioDuration(audioData: string): number {
  const size = getAudioSize(audioData);
  // Rough estimate: 44100 samples/sec * 2 bytes/sample * 2 channels = ~352800 bytes/sec
  // This is for uncompressed audio; actual duration may vary based on format
  const BYTES_PER_SECOND = 352800; // For 44.1kHz, 16-bit, stereo
  return size / BYTES_PER_SECOND;
}