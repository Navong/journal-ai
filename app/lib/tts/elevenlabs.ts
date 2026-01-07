// app/services/providers/tts/elevenlabs.ts
import { TTSProvider } from './interface';
import logger from "@/utils/logger";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

const log = logger.module('ElevenLabsTTSProvider');

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
        ELEVENLABS_API_KEY?: string;
        ELEVENLABS_VOICE_ID?: string;
        ELEVENLABS_MODEL?: string;
        ELEVENLABS_OUTPUT_FORMAT?: string;
    };
};

export class ElevenLabsTTSProvider implements TTSProvider {
    private client: ElevenLabsClient;
    private voiceId: string;
    private model: string;
    private outputFormat: string;

    constructor() {
        const apiKey = process.env.ELEVENLABS_API_KEY;
        if (!apiKey) {
            throw new Error('ELEVENLABS_API_KEY is not configured. Please set ELEVENLABS_API_KEY in your .env.local file');
        }

        // Initialize ElevenLabs SDK client
        this.client = new ElevenLabsClient({
            apiKey: apiKey,
            environment: "https://api.elevenlabs.io",
        });

        // Default voice ID - can be overridden via env var
        // Popular voices: 21m00Tcm4TlvDq8ikWAM (Rachel), pNInz6obpgDQGcFmaJgB (Adam)
        // See: https://elevenlabs.io/docs/api-reference/get-voices
        this.voiceId = process.env.ELEVENLABS_VOICE_ID || 'JBFqnCBsd6RMkjVDRZzb'; // Rachel (default)
        // Default model - can be overridden via env var
        // Options: eleven_multilingual_v2, eleven_turbo_v2_5, eleven_flash_v2_5
        this.model = process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2';
        // Default output format - MP3 works with all tiers, PCM_44100 requires Pro tier
        // Options: mp3_44100_128 (all tiers), pcm_44100 (Pro tier+), pcm_22050 (all tiers)
        this.outputFormat = process.env.ELEVENLABS_OUTPUT_FORMAT || 'mp3_44100_128'; // MP3 works with all subscription tiers
    }

    async generateSpeechStream(text: string): Promise<ReadableStream<Uint8Array> | undefined> {
        const cleanedContent = cleanTextForTTS(text);
        const maxRetries = 3;
        let lastError: any = null;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                const requestStartTime = Date.now();
                log.debug(`[TTS API] Starting ElevenLabs TTS generation (attempt ${attempt + 1}/${maxRetries})...`);
                log.debug(`[TTS API] Text length: ${cleanedContent.length} characters`);

                // Use ElevenLabs SDK for streaming with timestamps
                // Documentation: https://elevenlabs.io/docs/api-reference/text-to-speech/stream-with-timestamps
                const fetchStartTime = Date.now();
                const streamResponse = await this.client.textToSpeech.streamWithTimestamps(this.voiceId, {
                    outputFormat: this.outputFormat as any,
                    text: cleanedContent,
                    modelId: this.model,
                    voiceSettings: {
                        stability: 0.5,
                        similarityBoost: 0.75,
                    },
                });

                const fetchTime = Date.now() - fetchStartTime;
                const totalTimeToResponse = Date.now() - requestStartTime;
                log.debug(`[TTS API] ⏱️ SDK stream obtained in ${fetchTime}ms (total: ${totalTimeToResponse}ms from request start)`);

                // Simplified and more robust streaming implementation
                // The SDK returns an async iterable of chunks with audioBase64
                const outputFormat = this.outputFormat;
                const isMP3 = outputFormat.startsWith('mp3');

                const stream = new ReadableStream({
                    async start(controller) {
                        let streamClosed = false;
                        let streamErrored = false;

                        const safeEnqueue = (chunk: Uint8Array) => {
                            if (!streamClosed && !streamErrored) {
                                try {
                                    controller.enqueue(chunk);
                                } catch (e: any) {
                                    log.warn('[TTS API] Failed to enqueue chunk:', e?.message || String(e));
                                    streamClosed = true;
                                }
                            }
                        };

                        const safeClose = () => {
                            if (!streamClosed && !streamErrored) {
                                try {
                                    controller.close();
                                    streamClosed = true;
                                } catch (e: any) {
                                    log.warn('[TTS API] Failed to close stream:', e?.message || String(e));
                                }
                            }
                        };

                        const safeError = (error: any) => {
                            if (!streamErrored && !streamClosed) {
                                try {
                                    controller.error(error);
                                    streamErrored = true;
                                } catch (e: any) {
                                    log.warn('[TTS API] Failed to error stream:', e?.message || String(e));
                                }
                            }
                        };

                        let timeout: NodeJS.Timeout | undefined;

                        try {
                            let chunkCount = 0;
                            let totalBytes = 0;
                            const pcmChunks: Uint8Array[] = [];

                            // Add timeout for long streams (5 minutes max)
                            timeout = setTimeout(() => {
                                log.warn('[TTS API] Stream timeout reached');
                                safeError(new Error('Stream timeout'));
                            }, 5 * 60 * 1000);

                            for await (const chunk of streamResponse) {
                                if (streamClosed || streamErrored) break;

                                if (chunk.audioBase64) {
                                    const base64Data = chunk.audioBase64;
                                    const binaryString = atob(base64Data);
                                    const audioBytes = new Uint8Array(binaryString.length);
                                    for (let i = 0; i < binaryString.length; i++) {
                                        audioBytes[i] = binaryString.charCodeAt(i);
                                    }

                                    chunkCount++;
                                    totalBytes += audioBytes.length;

                                    if (isMP3) {
                                        // Stream MP3 chunks directly
                                        safeEnqueue(audioBytes);
                                    } else {
                                        // Accumulate PCM for WAV conversion
                                        pcmChunks.push(audioBytes);
                                    }

                                    // Log progress occasionally
                                    if (chunkCount <= 3 || chunkCount % 10 === 0) {
                                        log.debug(`[TTS API] Chunk ${chunkCount}: ${(audioBytes.length / 1024).toFixed(1)}KB (${isMP3 ? 'MP3' : 'PCM'})`);
                                    }
                                }
                            }

                            clearTimeout(timeout);

                            if (totalBytes === 0) {
                                throw new Error('No audio data received from ElevenLabs');
                            }

                            if (isMP3) {
                                safeClose();
                                log.debug(`[TTS API] ✅ MP3 stream complete: ${chunkCount} chunks, ${(totalBytes / 1024).toFixed(1)}KB`);
                            } else {
                                // Convert PCM to WAV
                                const pcmData = new Uint8Array(totalBytes);
                                let offset = 0;
                                for (const chunk of pcmChunks) {
                                    pcmData.set(chunk, offset);
                                    offset += chunk.length;
                                }

                                const wavData = pcmToWav(pcmData, 44100, 1);
                                safeEnqueue(wavData);
                                safeClose();
                                log.debug(`[TTS API] ✅ PCM stream complete: ${chunkCount} chunks, ${(wavData.length / 1024).toFixed(1)}KB WAV`);
                            }
                        } catch (error: any) {
                            if (timeout) clearTimeout(timeout);
                            log.error('[TTS API] Stream error:', error.message);
                            safeError(error);
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

                // Check for payment/quota errors
                const isPaymentError =
                    errorStatus === 402 ||
                    errorStatus === 403 ||
                    errorMessage.toLowerCase().includes('quota') ||
                    errorMessage.toLowerCase().includes('subscription') ||
                    errorMessage.toLowerCase().includes('credits') ||
                    errorMessage.toLowerCase().includes('pro tier') ||
                    errorMessage.toLowerCase().includes('payment required');

                if (isPaymentError) {
                    log.error('[TTS API] Payment/quota error:', {
                        status: errorStatus,
                        message: errorMessage,
                    });
                    throw new Error('TTS service payment/quota issue. Please check your ElevenLabs account.');
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

/**
 * Convert raw PCM audio data to WAV format by adding WAV headers
 * @param pcmData Raw PCM audio data (16-bit, little-endian)
 * @param sampleRate Sample rate in Hz (default: 44100)
 * @param channels Number of channels (default: 1 for mono)
 * @returns WAV file as Uint8Array
 */
function pcmToWav(pcmData: Uint8Array, sampleRate: number = 44100, channels: number = 1): Uint8Array {
    // Validate input
    if (pcmData.length === 0) {
        throw new Error('PCM data is empty');
    }

    // Ensure data length is even (16-bit samples = 2 bytes per sample)
    const dataSize = pcmData.length % 2 === 0 ? pcmData.length : pcmData.length - 1;
    if (dataSize !== pcmData.length) {
        console.warn(`[WAV] PCM data length ${pcmData.length} is odd, using ${dataSize} bytes`);
    }

    const bytesPerSample = 2; // 16-bit = 2 bytes
    const blockAlign = channels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const totalFileSize = 44 + dataSize; // 44 bytes header + data
    const riffChunkSize = totalFileSize - 8; // RIFF chunk size = file size - 8 (excludes "RIFF" and size fields)

    // Create WAV header buffer
    const header = new ArrayBuffer(44);
    const view = new DataView(header);

    // RIFF chunk descriptor
    view.setUint32(0, 0x46464952, true); // "RIFF" (little-endian)
    view.setUint32(4, riffChunkSize, true); // Chunk size (file size - 8)
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

    // Combine header and PCM data
    const wavFile = new Uint8Array(44 + dataSize);
    wavFile.set(new Uint8Array(header), 0);
    wavFile.set(pcmData.slice(0, dataSize), 44);

    return wavFile;
}
