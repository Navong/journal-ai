// app/services/providers/tts/gemini.ts
import { GoogleGenAI } from '@google/genai';
import { TTSProvider } from './interface';
import logger from "@/app/utils/logger";

const log = logger.module('GeminiTTSProvider');

function cleanTextForTTS(text: string): string {
  return text
    .replace(/[#*`_~]/g, '')
    .replace(/[\[\][^)]+\]\([^)]+\)/g, '$1')
    .replace(/- /g, '')
    .replace(/\n+/g, ' ')
    .trim();
}

/**
 * Convert base64-encoded PCM audio to WAV format
 * @param pcmBase64 Base64-encoded PCM audio data (16-bit, little-endian)
 * @param sampleRate Sample rate in Hz (default: 24000 for Gemini TTS)
 * @param channels Number of channels (default: 1 for mono)
 * @returns WAV file as Uint8Array
 */
function pcmToWav(pcmBase64: string, sampleRate: number = 24000, channels: number = 1): Uint8Array {
  // Decode base64 to raw PCM bytes
  const binaryString = atob(pcmBase64);
  const pcmData = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    pcmData[i] = binaryString.charCodeAt(i);
  }

  // Validate PCM data
  if (pcmData.length === 0) {
    throw new Error('PCM data is empty');
  }

  // Debug: Check first few bytes to ensure data looks valid
  if (pcmData.length >= 100) {
    const firstBytes = Array.from(pcmData.slice(0, 20)).map(b => b.toString(16).padStart(2, '0')).join(' ');
    const middleBytes = Array.from(pcmData.slice(1000, 1020)).map(b => b.toString(16).padStart(2, '0')).join(' ');
    log.debug(`[WAV] First 20 PCM bytes: ${firstBytes}`);
    log.debug(`[WAV] Middle 20 PCM bytes (offset 1000): ${middleBytes}`);

    // Check for non-zero data
    let nonZeroCount = 0;
    for (let i = 0; i < Math.min(1000, pcmData.length); i++) {
      if (pcmData[i] !== 0) nonZeroCount++;
    }
    log.debug(`[WAV] Non-zero bytes in first 1000: ${nonZeroCount}/1000`);
  }

  // Ensure data length is even (16-bit samples = 2 bytes per sample)
  const dataSize = pcmData.length % 2 === 0 ? pcmData.length : pcmData.length - 1;
  if (dataSize !== pcmData.length) {
    log.warn(`[WAV] PCM data length ${pcmData.length} is odd, using ${dataSize} bytes`);
  }

  // CRITICAL: Gemini returns L16 format (big-endian), but WAV needs little-endian
  // We must swap byte pairs to convert from big-endian to little-endian
  log.debug(`[WAV] Converting big-endian PCM to little-endian for WAV format`);
  const swappedPcmData = new Uint8Array(dataSize);
  for (let i = 0; i < dataSize; i += 2) {
    swappedPcmData[i] = pcmData[i + 1];     // Swap high byte to low
    swappedPcmData[i + 1] = pcmData[i];     // Swap low byte to high
  }

  // Debug: Check swapped data
  if (swappedPcmData.length >= 20) {
    const swappedFirst = Array.from(swappedPcmData.slice(0, 20)).map(b => b.toString(16).padStart(2, '0')).join(' ');
    log.debug(`[WAV] First 20 bytes after byte-swap: ${swappedFirst}`);
  }

  const bytesPerSample = 2; // 16-bit = 2 bytes
  const blockAlign = channels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const totalFileSize = 44 + dataSize; // 44 bytes header + data
  const riffChunkSize = totalFileSize - 8;

  // Create WAV header buffer
  const header = new ArrayBuffer(44);
  const view = new DataView(header);

  // RIFF chunk descriptor
  view.setUint32(0, 0x46464952, true); // "RIFF" (little-endian)
  view.setUint32(4, riffChunkSize, true);
  view.setUint32(8, 0x45564157, true); // "WAVE" (little-endian)

  // fmt sub-chunk
  view.setUint32(12, 0x20746d66, true); // "fmt " (little-endian)
  view.setUint32(16, 16, true); // Sub-chunk size (16 for PCM)
  view.setUint16(20, 1, true); // Audio format (1 = PCM)
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // Bits per sample

  // data sub-chunk
  view.setUint32(36, 0x61746164, true); // "data" (little-endian)
  view.setUint32(40, dataSize, true);

  // Combine header and swapped PCM data (now little-endian)
  const wavFile = new Uint8Array(44 + dataSize);
  wavFile.set(new Uint8Array(header), 0);
  wavFile.set(swappedPcmData, 44);

  return wavFile;
}

declare const process: {
  env: {
    NEXT_PUBLIC_GEMINI_API_KEY?: string;
    GEMINI_API_KEY?: string;
    GEMINI_TTS_VOICE?: string;
    GEMINI_TTS_STYLE?: string;
  };
};

export class GeminiTTSProvider implements TTSProvider {
  private ai: GoogleGenAI;
  private voiceName: string;
  private stylePrefix: string;

  constructor() {
    // Reuse Gemini API key from existing configuration
    const apiKey = process.env.NEXT_PUBLIC_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not configured. Please set NEXT_PUBLIC_GEMINI_API_KEY in your .env.local file');
    }

    this.ai = new GoogleGenAI({ apiKey });

    // Voice configuration (30+ options available)
    // Popular voices: Kore, Puck, Aoede, Charon, Fenrir
    // Browse voices at: https://ai.google.dev/gemini-api/docs/speech-generation#voices
    this.voiceName = process.env.GEMINI_TTS_VOICE || 'Kore';

    // Optional style prefix for natural language control
    // Examples: "Say calmly:", "Speak slowly and warmly:", "Speak naturally:"
    this.stylePrefix = process.env.GEMINI_TTS_STYLE || 'Say naturally:';
  }

  async generateSpeechStream(text: string): Promise<ReadableStream<Uint8Array> | undefined> {
    const cleanedContent = cleanTextForTTS(text);
    const maxRetries = 3;
    let lastError: any = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const requestStartTime = Date.now();
        log.debug(`[TTS API] Starting Gemini TTS generation (attempt ${attempt + 1}/${maxRetries})...`);
        log.debug(`[TTS API] Text length: ${cleanedContent.length} characters`);

        // Add natural language style prefix to control delivery
        const styledText = `${this.stylePrefix} ${cleanedContent}`;

        // Call Gemini TTS API
        // Documentation: https://ai.google.dev/gemini-api/docs/speech-generation
        const apiStartTime = Date.now();
        const response = await this.ai.models.generateContent({
          model: 'gemini-2.5-flash-preview-tts',
          contents: [{ parts: [{ text: styledText }] }],
          config: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: this.voiceName },
              },
            },
          },
        });

        const apiResponseTime = Date.now() - apiStartTime;
        log.debug(`[TTS API] ⏱️ Gemini API response received in ${apiResponseTime}ms`);

        // Extract base64 PCM audio data from response
        const audioBase64 = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        const mimeType = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.mimeType;

        if (!audioBase64) {
          log.error('[TTS API] No audio data in Gemini TTS response', { response: JSON.stringify(response, null, 2) });
          throw new Error('No audio data in Gemini TTS response');
        }

        log.debug(`[TTS API] Audio data received: ${(audioBase64.length / 1024).toFixed(0)}KB base64`);
        log.debug(`[TTS API] MIME type: ${mimeType || 'not specified'}`);

        // Convert PCM to WAV format
        const convertStartTime = Date.now();
        const wavData = pcmToWav(audioBase64, 24000);
        const convertTime = Date.now() - convertStartTime;
        log.debug(`[TTS API] PCM to WAV conversion completed in ${convertTime}ms: ${(wavData.length / 1024).toFixed(0)}KB`);

        // Create streaming ReadableStream with chunking for progressive playback
        const CHUNK_SIZE = 8 * 1024; // 8KB chunks for smooth playback
        const stream = new ReadableStream({
          start(controller) {
            try {
              let offset = 0;
              let chunkCount = 0;
              const streamStartTime = Date.now();

              // Send WAV data in chunks for progressive streaming
              const sendChunk = () => {
                if (offset < wavData.length) {
                  const chunk = wavData.slice(offset, Math.min(offset + CHUNK_SIZE, wavData.length));
                  controller.enqueue(chunk);
                  offset += CHUNK_SIZE;
                  chunkCount++;

                  if (chunkCount === 1) {
                    const firstChunkTime = Date.now() - requestStartTime;
                    log.debug(`[TTS API] 🎵 First chunk sent to client: ${firstChunkTime}ms from request start`);
                  }

                  // Log progress
                  if (chunkCount <= 5 || chunkCount % 20 === 0) {
                    const elapsed = Date.now() - streamStartTime;
                    const rate = (offset / 1024) / (elapsed / 1000);
                    log.debug(`[TTS API] Chunk ${chunkCount}: ${chunk.length} bytes, total: ${(offset / 1024).toFixed(0)}KB, rate: ${rate.toFixed(2)}KB/s`);
                  }

                  // Use setTimeout for non-blocking chunking
                  setTimeout(sendChunk, 0);
                } else {
                  controller.close();
                  const totalTime = Date.now() - requestStartTime;
                  const streamTime = Date.now() - streamStartTime;
                  const finalRate = (wavData.length / 1024) / (streamTime / 1000);

                  log.debug(`[TTS API] ✅ Stream complete: ${chunkCount} chunks, ${(wavData.length / 1024).toFixed(0)}KB WAV in ${streamTime}ms`);
                  log.debug(`[TTS API] 📊 Performance: ${finalRate.toFixed(2)}KB/s streaming rate`);
                  log.debug(`[TTS API] ⏱️ Total latency: ${totalTime}ms from request start (API: ${apiResponseTime}ms, convert: ${convertTime}ms, stream: ${streamTime}ms)`);
                }
              };

              sendChunk();
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

        // Check for payment/quota errors (402, 403)
        const isPaymentError =
          errorStatus === 402 ||
          errorStatus === 403 ||
          errorMessage.includes('402') ||
          errorMessage.includes('403') ||
          errorMessage.toLowerCase().includes('payment required') ||
          errorMessage.toLowerCase().includes('quota exceeded') ||
          errorMessage.toLowerCase().includes('insufficient funds');

        if (isPaymentError) {
          log.error('[TTS API] Payment/quota error:', {
            status: errorStatus,
            message: errorMessage,
          });
          throw new Error('TTS service payment/quota issue. Please check your Gemini API account.');
        }

        // Check for rate limit errors (429)
        const isRateLimit =
          errorStatus === 429 ||
          errorMessage.includes('429') ||
          errorMessage.toLowerCase().includes('rate limit') ||
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
