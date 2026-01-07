// app/services/providers/tts/cartesia.ts
import { CartesiaClient } from '@cartesia/cartesia-js';
import { TTSProvider } from './interface';
import logger from "@/utils/logger";

const log = logger.module('CartesiaTTSProvider');

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
    CARTESIA_API_KEY?: string;
    CARTESIA_VOICE_ID?: string;
  };
};

export class CartesiaTTSProvider implements TTSProvider {
  private client: CartesiaClient;
  private voiceId: string;

  constructor() {
    const apiKey = process.env.CARTESIA_API_KEY;
    if (!apiKey) {
      throw new Error('CARTESIA_API_KEY is not configured. Please set CARTESIA_API_KEY in your .env.local file');
    }
    this.client = new CartesiaClient({ apiKey });
    this.voiceId = process.env.CARTESIA_VOICE_ID || '694f9389-aac1-45b6-b726-9d9369183238';
  }

  async generateSpeechStream(text: string): Promise<ReadableStream<Uint8Array> | undefined> {
    const cleanedContent = cleanTextForTTS(text);
    const maxRetries = 3;
    let lastError: any = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const ttsStartTime = Date.now();
        log.debug(`[TTS API] Starting TTS generation (attempt ${attempt + 1}/${maxRetries})...
`);

        // Use MP3 for smaller file size (compressed format)
        // Cartesia may return MP3 as a complete buffer, so we'll chunk it manually for progressive streaming
        // Documentation: https://docs.cartesia.ai/api-reference/tts/bytes#mp3outputformat
        const outputFormat = {
          container: 'raw' as const,
          sampleRate: 44100, // CD quality - matches Cartesia docs recommendation (in Hz)
          encoding: 'pcm_s16le' as const,
        };
        log.debug('[TTS API] Using MP3 format for smaller file size:', outputFormat);

        const response = await this.client.tts.bytes({
          modelId: 'sonic-2',
          transcript: cleanedContent,
          voice: {
            mode: 'id',
            id: this.voiceId,
          },
          language: 'en',
          outputFormat,
          speed: 'slow', // Slower pace for more natural, relaxed listening
        });

        const ttsResponseTime = Date.now() - ttsStartTime;
        log.debug(`[TTS API] TTS API response received in ${ttsResponseTime}ms
`);

        // Stream binary audio chunks directly to client (no base64 conversion)
        const stream = new ReadableStream({
          async start(controller) {
            try {
              let streamReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
              let totalBytes = 0;
              let chunkCount = 0;
              const streamStartTime = Date.now();
              let firstChunkTime: number | null = null;

              // Helper to get stream reader from Cartesia response
              const getStreamReader = (): ReadableStreamDefaultReader<Uint8Array> => {
                if (response instanceof ArrayBuffer || response instanceof Uint8Array) {
                  // Direct buffer - chunk it manually for progressive streaming
                  // This is important for MP3 format which may come as a single buffer
                  const buffer = response instanceof ArrayBuffer ? new Uint8Array(response) : new Uint8Array(response);
                  const CHUNK_SIZE = 8 * 1024; // 8KB chunks for better progressive streaming (smaller = faster start)
                  const stream = new ReadableStream({
                    start(ctrl) {
                      let offset = 0;
                      const sendChunk = () => {
                        if (offset < buffer.length) {
                          const chunk = buffer.slice(offset, Math.min(offset + CHUNK_SIZE, buffer.length));
                          ctrl.enqueue(chunk);
                          offset += CHUNK_SIZE;
                          // Use setTimeout to allow other operations between chunks
                          setTimeout(sendChunk, 0);
                        } else {
                          ctrl.close();
                        }
                      };
                      sendChunk();
                    }
                  });
                  return stream.getReader();
                }

                if (response && typeof response === 'object') {
                  const streamResponse = response as any;

                  // Try different ways to get the reader
                  if (streamResponse.reader) {
                    return streamResponse.reader;
                  } else if (streamResponse.readableStream && !streamResponse.readableStream.locked) {
                    return streamResponse.readableStream.getReader();
                  } else if (streamResponse.source && typeof streamResponse.source[Symbol.asyncIterator] === 'function') {
                    // Convert async iterator to ReadableStream
                    const source = streamResponse.source;
                    const readableStream = new ReadableStream({
                      async start(ctrl) {
                        try {
                          for await (const chunk of source) {
                            ctrl.enqueue(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk));
                          }
                          ctrl.close();
                        } catch (err) {
                          ctrl.error(err);
                        }
                      }
                    });
                    return readableStream.getReader();
                  }
                }

                throw new Error('Unable to get stream reader from response');
              };

              streamReader = getStreamReader();
              log.debug(`[TTS API] Stream reader obtained, starting to read chunks...
`);

              // Read and stream binary chunks as they arrive
              while (true) {
                const chunkReceiveStart = Date.now();
                const { done, value } = await streamReader.read();
                const chunkReceiveTime = Date.now() - chunkReceiveStart;

                if (done) break;

                if (value) {
                  if (firstChunkTime === null) {
                    firstChunkTime = Date.now();
                    log.debug(`[TTS API] First chunk received from Cartesia in ${firstChunkTime - streamStartTime}ms (${value.length} bytes, read took ${chunkReceiveTime}ms)
`);
                  }

                  // Send binary chunk directly to client immediately
                  const sendStart = Date.now();
                  controller.enqueue(value);
                  const sendTime = Date.now() - sendStart;

                  if (chunkCount === 0) {
                    const firstChunkSentTime = Date.now();
                    log.debug(`[TTS API] First chunk sent to client in ${firstChunkSentTime - streamStartTime}ms (enqueue took ${sendTime}ms)
`);
                  }

                  totalBytes += value.length;
                  chunkCount++;

                  // Log every chunk for first 5 chunks, then every 10 or every 100KB
                  if (chunkCount <= 5 || chunkCount % 10 === 0 || totalBytes % (100 * 1024) < value.length) {
                    const elapsed = Date.now() - streamStartTime;
                    const rate = (totalBytes / 1024) / (elapsed / 1000);
                    log.debug(`[TTS API] Chunk ${chunkCount}: ${value.length} bytes, total: ${(totalBytes / 1024).toFixed(0)}KB, rate: ${rate.toFixed(2)}KB/s (read: ${chunkReceiveTime}ms, send: ${sendTime}ms)
`);
                  }
                }
              }

              controller.close();

              const totalTime = Date.now() - streamStartTime;
              log.debug(`[TTS API] ✅ Streamed ${totalBytes} bytes to client in ${totalTime}ms (${chunkCount} chunks, ${(totalBytes / 1024 / (totalTime / 1000)).toFixed(2)}KB/s)
`);

              // Release reader if needed
              if (streamReader && 'releaseLock' in streamReader) {
                streamReader.releaseLock();
              }
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
          errorMessage.toLowerCase().includes('insufficient funds') ||
          errorMessage.toLowerCase().includes('quota exceeded');

        // Check if it's a rate limit error
        const isRateLimit =
          errorStatus === 429 ||
          errorMessage.includes('429') ||
          errorMessage.includes('rate limit') ||
          errorMessage.toLowerCase().includes('resource_exhausted');

        // Payment/quota errors should not be retried
        if (isPaymentError) {
          log.error('[TTS API] Payment/quota error:', {
            status: errorStatus,
            message: errorMessage,
          });
          throw new Error('TTS service payment/quota issue. Please check your Cartesia account.');
        }

        if (isRateLimit && attempt < maxRetries - 1) {
          // Exponential backoff: 2^attempt seconds
          const waitTime = Math.pow(2, attempt) * 1000;
          log.warn(`[TTS API] Rate limit hit, retrying after ${waitTime}ms (attempt ${attempt + 1}/${maxRetries})
`);
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
