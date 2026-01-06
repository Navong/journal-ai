// app/services/providers/tts/murf.ts
import { TTSProvider } from './interface';
import logger from "@/app/utils/logger";

const log = logger.module('MurfTTSProvider');

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
    MURF_API_KEY?: string;
    MURF_VOICE_ID?: string;
    MURF_STYLE?: string;
    MURF_MODEL?: string;
    MURF_FORMAT?: string; // Audio format: 'pcm', 'mp3', 'wav' (default: 'pcm' for lowest latency)
    MURF_SAMPLE_RATE?: string; // Sample rate in Hz (default: 44100)
  };
};

// Murf.ai API endpoint
// Documentation: https://murf.ai/api/docs
const MURF_API_BASE_URL = 'https://api.murf.ai/v1';
const MURF_STREAM_ENDPOINT = `${MURF_API_BASE_URL}/speech/stream`;

export class MurfTTSProvider implements TTSProvider {
  private apiKey: string;
  private voiceId: string;
  private style: string;
  private model: string;
  private format: string;
  private sampleRate: number;

  constructor() {
    const apiKey = process.env.MURF_API_KEY;
    if (!apiKey) {
      throw new Error('MURF_API_KEY is not configured. Please set MURF_API_KEY in your .env.local file');
    }
    this.apiKey = apiKey;
    // Voice configuration - can be overridden via env vars
    // Default: Miles voice with Calm style, Gen2 model
    this.voiceId = process.env.MURF_VOICE_ID || 'Miles';
    this.style = process.env.MURF_STYLE || 'Calm';
    this.model = process.env.MURF_MODEL || 'Gen2';
    // Audio format: 'pcm' for lowest latency (uncompressed, no encoding), 'mp3' for smaller files, 'wav' for compatibility
    // Default: 'pcm' for lowest latency
    this.format = process.env.MURF_FORMAT || 'pcm';
    this.sampleRate = parseInt(process.env.MURF_SAMPLE_RATE || '48000', 10);
  }

  async generateSpeechStream(text: string): Promise<ReadableStream<Uint8Array> | undefined> {
    const cleanedContent = cleanTextForTTS(text);
    const maxRetries = 3;
    let lastError: any = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const requestStartTime = Date.now();
        log.debug(`[TTS API] Starting Murf TTS generation (attempt ${attempt + 1}/${maxRetries})...`);
        log.debug(`[TTS API] Text length: ${cleanedContent.length} characters`);

        // Murf.ai supports streaming TTS
        // Using Gen2 model with Miles voice and Calm style
        // Documentation: https://murf.ai/api/docs/capabilities/text-to-speech/streaming
        // Endpoint: POST /v1/speech/stream
        const fetchStartTime = Date.now();
        const response = await fetch(MURF_STREAM_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'api-key': this.apiKey, // Murf uses 'api-key' header, not 'Authorization: Bearer'
          },
          body: JSON.stringify({
            text: cleanedContent,
            voice_id: this.voiceId,
            style: this.style,
            model: this.model, // Gen2 model for studio-quality speech
            format: this.format, // PCM for lowest latency (uncompressed), MP3 for smaller files, WAV for compatibility
            sample_rate: this.sampleRate, // Professional quality (48000 Hz)
            rate: -5, // Speed: -5% (slower)
          })
        });

        const fetchTime = Date.now() - fetchStartTime;
        const totalTimeToResponse = Date.now() - requestStartTime;
        log.debug(`[TTS API] ⏱️ Fetch completed in ${fetchTime}ms (total: ${totalTimeToResponse}ms from request start)`);
        log.debug(`[TTS API] Request URL: ${MURF_STREAM_ENDPOINT}`);
        log.debug(`[TTS API] Request body: ${JSON.stringify({ text: cleanedContent.substring(0, 50) + '...', voice_id: this.voiceId, style: this.style, model: this.model, format: this.format, sample_rate: this.sampleRate, rate: -5 })}`);

        if (!response.ok) {
          const errorText = await response.text().catch(() => 'Unknown error');
          let errorData: any;
          try {
            errorData = JSON.parse(errorText);
          } catch {
            errorData = { message: errorText };
          }

          const errorStatus = response.status;
          const errorMessage = errorData?.errorMessage || errorData?.error?.message || errorData?.message || errorText;

          log.error(`[TTS API] Murf API error (${errorStatus}):`, {
            status: errorStatus,
            message: errorMessage,
            errorCode: errorData?.errorCode,
            url: MURF_STREAM_ENDPOINT,
          });

          // Check for payment/quota errors
          const isPaymentError =
            errorStatus === 402 ||
            errorStatus === 403 ||
            errorMessage.includes('402') ||
            errorMessage.includes('403') ||
            errorMessage.toLowerCase().includes('payment required') ||
            errorMessage.toLowerCase().includes('quota exceeded') ||
            errorMessage.toLowerCase().includes('billing') ||
            errorMessage.toLowerCase().includes('unauthorized');

          // Check if it's a rate limit error
          const isRateLimit =
            errorStatus === 429 ||
            errorMessage.includes('429') ||
            errorMessage.toLowerCase().includes('rate limit') ||
            errorMessage.toLowerCase().includes('resource_exhausted');

          if (isPaymentError) {
            log.error('[TTS API] Payment/quota error:', {
              status: errorStatus,
              message: errorMessage,
            });
            throw new Error('TTS service payment/quota issue. Please check your Murf.ai account.');
          }

          if (isRateLimit && attempt < maxRetries - 1) {
            // Exponential backoff: 2^attempt seconds
            const waitTime = Math.pow(2, attempt) * 1000;
            log.warn(`[TTS API] Rate limit hit, retrying after ${waitTime}ms (attempt ${attempt + 1}/${maxRetries})`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            continue;
          }

          throw new Error(`Murf TTS API error (${errorStatus}): ${errorMessage}`);
        }

        // Check if response is streaming
        const contentType = response.headers.get('Content-Type') || '';
        if (contentType.includes('audio/') && response.body) {
          // Streaming audio response - pass through directly to avoid backpressure
          // Wrapping in a new ReadableStream creates backpressure issues when client slows down
          // By passing response.body directly, we eliminate the wrapper layer that causes stalls
          log.debug(`[TTS API] Streaming audio response detected (${contentType}) - passing through directly`);
          log.debug(`[TTS API] ⏱️ Time to first response: ${Date.now() - requestStartTime}ms`);

          // Pass response.body directly to avoid wrapper backpressure
          // This prevents 3-second stalls when client audio playback slows consumption
          // 
          // NOTE: If stalls still occur after this fix, check:
          // 1. Murf API dashboard for rate limits or throttling
          // 2. Network latency to api.murf.ai
          // 3. Server logs for "Large gap detected" warnings (if we add monitoring)
          // 
          // To diagnose API latency vs backpressure:
          // - If stalls happen even when audio NOT playing → likely API latency
          // - If stalls only when audio playing → likely backpressure (should be fixed now)
          return response.body;
        }

        // Non-streaming response - parse JSON and extract audio
        const responseData = await response.json();
        const ttsResponseTime = Date.now();

        // Extract audio data from response (if returned as base64)
        let audioData: Uint8Array | null = null;

        if (responseData.audio) {
          // Decode base64 audio data if present
          const base64Data = responseData.audio;
          const binaryString = atob(base64Data);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          audioData = bytes;
        } else if (responseData.content) {
          // Handle different response formats
          const content = responseData.content;
          if (typeof content === 'string') {
            const binaryString = atob(content);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }
            audioData = bytes;
          }
        }

        if (!audioData) {
          throw new Error('No audio data found in Murf TTS response');
        }

        const extractTime = Date.now() - ttsResponseTime;
        log.debug(`[TTS API] Audio data extracted: ${(audioData.length / 1024).toFixed(0)}KB (extraction: ${extractTime}ms)`);

        // Create a ReadableStream from the audio data
        const stream = new ReadableStream({
          start(controller) {
            try {
              const sendStart = Date.now();
              controller.enqueue(audioData);
              controller.close();
              const sendTime = Date.now() - sendStart;

              const totalTime = Date.now() - requestStartTime;
              const dataRate = (audioData.length / 1024) / (totalTime / 1000);
              log.debug(`[TTS API] ✅ Streamed ${audioData.length} bytes to client in ${totalTime}ms`);
              log.debug(`[TTS API] 📊 Performance: ${dataRate.toFixed(2)}KB/s, send time: ${sendTime}ms`);
              log.debug(`[TTS API] ⏱️ Latency breakdown: fetch: ${fetchTime}ms, extract: ${extractTime}ms, send: ${sendTime}ms`);
            } catch (error: any) {
              log.error('[TTS API] Stream error:', error);
              controller.error(error);
              throw error;
            }
          }
        });

        return stream;

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

        // If not a rate limit error or last attempt, throw
        if (!isRateLimit || attempt === maxRetries - 1) {
          throw error;
        }
      }
    }

    throw lastError || new Error('Failed to generate speech stream');
  }
}

