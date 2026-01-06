// app/services/providers/tts/fish.ts
import { TTSProvider } from './interface';
import logger from "@/app/utils/logger";
import { FishAudioClient } from "fish-audio";
import type { Mood } from '@/app/types';

const log = logger.module('FishAudioTTSProvider');

/**
 * Maps journal mood to Fish Audio emotion tag
 * @param mood - Journal mood (calm, joyful, anxious, tired, reflective, heavy, none)
 * @returns Fish Audio emotion string (without parentheses) or empty string
 */
export function moodToFishEmotion(mood: Mood): string {
  const moodMap: Record<Mood, string> = {
    'calm': 'calm',
    'joyful': 'happy',
    'anxious': 'anxious',
    'tired': 'calm',  // Use calm for tired (low energy, relaxed delivery)
    'reflective': 'calm',  // Use calm for reflective (thoughtful, contemplative)
    'heavy': 'sad',
    'none': ''  // No emotion for neutral mood
  };

  return moodMap[mood] || '';
}

/**
 * Injects Fish Audio emotion tag at the beginning of text
 * Format: (emotion) Original text here.
 * @param text - Original text
 * @param emotion - Fish Audio emotion (e.g., 'calm', 'happy', 'sad')
 * @returns Text with emotion tag prepended, or original text if conditions not met
 */
export function injectFishEmotion(text: string, emotion: string): string {
  // Check if emotions are enabled (default: true)
  const emotionsEnabled = process.env.FISH_AUDIO_ENABLE_EMOTIONS !== 'false';

  // Don't inject if disabled, empty text, very short text, no emotion, or already has emotion tag
  if (!emotionsEnabled || !text || text.length < 10 || !emotion) {
    return text;
  }

  // Check if text already has emotion tags
  if (/^\([a-z]+\)/i.test(text.trim())) {
    log.debug(`Text already has emotion tag, skipping injection`);
    return text;
  }

  // Inject emotion tag at the beginning
  const emotionalText = `(${emotion}) ${text}`;
  log.debug(`Injected Fish Audio emotion: (${emotion})`);

  return emotionalText;
}

function cleanTextForTTS(text: string): string {
  return text
    .replace(/[#*`_~]/g, '')
    .replace(/[\[\][^)]+\]\([^)]+\)/g, '$1')
    .replace(/- /g, '')
    .replace(/\n+/g, ' ')
    .trim();
}

declare const process: {
  env: {
    FISH_AUDIO_API_KEY?: string;
    FISH_AUDIO_VOICE_ID?: string;
    FISH_AUDIO_MODEL?: string;
    FISH_AUDIO_FORMAT?: string;
    FISH_AUDIO_MP3_BITRATE?: string;
    FISH_AUDIO_SAMPLE_RATE?: string;
    FISH_AUDIO_ENABLE_EMOTIONS?: string;
  };
};

export class FishAudioTTSProvider implements TTSProvider {
  private client: FishAudioClient;
  private voiceId: string;
  private model: string;
  private format: string;
  private mp3Bitrate: number;
  private sampleRate: number;

  constructor() {
    const apiKey = process.env.FISH_AUDIO_API_KEY;
    if (!apiKey) {
      throw new Error('FISH_AUDIO_API_KEY is not configured. Please set FISH_AUDIO_API_KEY in your .env.local file');
    }

    this.client = new FishAudioClient({ apiKey });
    // Default voice ID - can be overridden via env var
    // Browse voices at: https://fish.audio (playground)
    this.voiceId = process.env.FISH_AUDIO_VOICE_ID || '07b24b514d844d589e8fd3d68ca15bd4'; // Default voice model
    // Model options: "s1" (latest), "speech-1.6" (stable), "speech-1.5" (legacy)
    this.model = process.env.FISH_AUDIO_MODEL || 's1'; // Latest model with best features
    // Format options: "mp3", "wav", "pcm", "opus"
    // Note: Use WAV instead of raw PCM for browser compatibility (WAV = PCM + headers)
    // Raw PCM cannot be decoded by browser's decodeAudioData() - it needs a container format
    this.format = process.env.FISH_AUDIO_FORMAT || 'wav'; // WAV for lowest latency with browser support
    // MP3 bitrate options: 64, 128, 192 (only used when format is 'mp3')
    this.mp3Bitrate = parseInt(process.env.FISH_AUDIO_MP3_BITRATE || '128', 10);
    // Sample rate options: 44100 (CD quality), 24000 (balanced), 16000 (low quality)
    this.sampleRate = parseInt(process.env.FISH_AUDIO_SAMPLE_RATE || '44100', 10);
  }

  async generateSpeechStream(text: string): Promise<ReadableStream<Uint8Array> | undefined> {
    const cleanedContent = cleanTextForTTS(text);
    const maxRetries = 3;
    let lastError: any = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const requestStartTime = Date.now();
        log.debug(`[TTS API] Starting Fish Audio TTS generation (attempt ${attempt + 1}/${maxRetries})...`);
        log.debug(`[TTS API] Text length: ${cleanedContent.length} characters`);

        // Fish Audio TTS conversion
        // Documentation: https://docs.fish.audio/developer-guide/core-features/text-to-speech#javascript
        const fetchStartTime = Date.now();
        const requestParams: any = {
          text: cleanedContent,
          reference_id: this.voiceId,
          format: this.format as any,
          latency: 'balanced', // Optimize for speed (~300ms latency)
        };

        // Add format-specific parameters
        if (this.format === 'mp3') {
          requestParams.mp3_bitrate = this.mp3Bitrate;
        } else if (this.format === 'pcm' || this.format === 'wav') {
          requestParams.sample_rate = this.sampleRate;
        }

        const httpResponse = await this.client.textToSpeech.convert(requestParams, this.model as any);

        const fetchTime = Date.now() - fetchStartTime;
        log.debug(`[TTS API] ⏱️ Fish Audio HTTP response received in ${fetchTime}ms`);

        // Fish Audio client returns ReadableStream directly
        const audioStream = httpResponse;
        
        // If it's already a ReadableStream, use it directly
        if (audioStream && typeof audioStream.getReader === 'function') {
          // Stream chunks directly to client (true streaming)
          const format = this.format; // Capture for use in stream callback
          let totalBytes = 0;
          let chunkCount = 0;
          const streamStartTime = Date.now();
          let firstChunkTime: number | null = null;

          const stream = new ReadableStream({
            async start(controller) {
              try {
                const reader = audioStream.getReader();

                while (true) {
                  const { done, value } = await reader.read();

                  if (done) {
                    controller.close();
                    
                    const streamTime = Date.now() - streamStartTime;
                    const totalTime = Date.now() - requestStartTime;
                    const finalRate = (totalBytes / 1024) / (streamTime / 1000);
                    const avgRate = (totalBytes / 1024) / (totalTime / 1000);

                    log.debug(`[TTS API] ✅ Stream complete: ${chunkCount} chunks, ${(totalBytes / 1024).toFixed(0)}KB ${format.toUpperCase()} in ${streamTime}ms`);
                    log.debug(`[TTS API] 📊 Performance: ${finalRate.toFixed(2)}KB/s streaming rate, ${avgRate.toFixed(2)}KB/s average`);
                    log.debug(`[TTS API] ⏱️ Total latency: ${totalTime}ms from request start (fetch: ${fetchTime}ms, stream: ${streamTime}ms)`);

                    if (firstChunkTime) {
                      const timeToFirstAudio = firstChunkTime - requestStartTime;
                      log.debug(`[TTS API] 🚀 Time to first audio chunk: ${timeToFirstAudio}ms`);
                    }
                    break;
                  }

                  if (value) {
                    if (firstChunkTime === null) {
                      firstChunkTime = Date.now();
                      const timeToFirstChunk = firstChunkTime - requestStartTime;
                      log.debug(`[TTS API] 🎵 First ${format.toUpperCase()} chunk received: ${timeToFirstChunk}ms from request start`);
                    }

                    controller.enqueue(value);
                    totalBytes += value.length;
                    chunkCount++;

                    // Log progress
                    if (chunkCount <= 5 || chunkCount % 50 === 0) {
                      const elapsed = Date.now() - streamStartTime;
                      const rate = (totalBytes / 1024) / (elapsed / 1000);
                      log.debug(`[TTS API] Chunk ${chunkCount}: ${value.length} bytes, total: ${(totalBytes / 1024).toFixed(0)}KB, rate: ${rate.toFixed(2)}KB/s`);
                    }
                  }
                }
              } catch (error: any) {
                log.error('[TTS API] Stream error:', error);
                controller.error(error);
                throw error;
              }
            }
          });

          return stream;
        }

        // Fallback: Fish Audio should always return a ReadableStream
        log.error(`[TTS API] Fish Audio did not return a ReadableStream, this should not happen`);
        throw new Error('Fish Audio did not return a valid stream');

      } catch (error: any) {
        lastError = error;

        // Extract error information
        const errorMessage = error?.message || '';
        const errorStatus = error?.status || error?.statusCode || error?.code || '';

        // Check if it's a rate limit error
        const isRateLimit =
          errorStatus === 429 ||
          errorMessage.includes('429') ||
          errorMessage.includes('rate limit') ||
          errorMessage.toLowerCase().includes('resource_exhausted');

        if (isRateLimit && attempt < maxRetries - 1) {
          // Exponential backoff: 2^attempt seconds
          const waitTime = Math.pow(2, attempt) * 1000;
          log.warn(`[TTS API] Rate limit hit, retrying after ${waitTime}ms (attempt ${attempt + 1}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue;
        }

        // Check for payment/quota errors
        const isPaymentError =
          errorStatus === 402 ||
          errorStatus === 403 ||
          errorMessage.toLowerCase().includes('quota') ||
          errorMessage.toLowerCase().includes('subscription') ||
          errorMessage.toLowerCase().includes('credits') ||
          errorMessage.toLowerCase().includes('payment required');

        if (isPaymentError) {
          log.error('[TTS API] Payment/quota error:', {
            status: errorStatus,
            message: errorMessage,
          });
          throw new Error('TTS service payment/quota issue. Please check your Fish Audio account.');
        }

        // If not a rate limit error or last attempt, throw
        if (!isRateLimit || attempt === maxRetries - 1) {
          throw error;
        }
      }
    }

    throw lastError || new Error('Failed to generate speech stream');
  }
}

