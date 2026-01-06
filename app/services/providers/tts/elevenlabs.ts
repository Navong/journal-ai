// app/services/providers/tts/elevenlabs.ts
import { TTSProvider } from './interface';
import logger from "@/app/utils/logger";
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
        this.voiceId = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM'; // Rachel (default)
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

                // The SDK returns an async iterable of chunks with audioBase64
                // Stream chunks progressively as they arrive (don't wait for all chunks)
                const outputFormat = this.outputFormat; // Capture for use in stream callback
                const stream = new ReadableStream({
                    async start(controller) {
                        try {
                            let chunkCount = 0;
                            const streamStartTime = Date.now();
                            let firstChunkTime: number | null = null;
                            let firstChunkSentTime: number | null = null;
                            let totalBytes = 0;
                            const isMP3 = outputFormat.startsWith('mp3');

                            // For MP3, we can stream directly. For PCM, we need to accumulate and convert to WAV at the end.
                            const pcmChunks: Uint8Array[] = [];

                            // Iterate over the SDK stream and send chunks immediately
                            for await (const chunk of streamResponse) {
                                if (firstChunkTime === null) {
                                    firstChunkTime = Date.now();
                                    const firstChunkLatency = firstChunkTime - requestStartTime;
                                    const timeFromFetch = firstChunkTime - fetchStartTime;
                                    log.debug(`[TTS API] ⚡ First audio chunk received: ${firstChunkLatency}ms from request start, ${timeFromFetch}ms from SDK call`);
                                }

                                // Extract base64 audio from chunk (SDK uses camelCase)
                                if (chunk.audioBase64) {
                                    // Decode base64 audio data
                                    const base64Data = chunk.audioBase64;
                                    const binaryString = atob(base64Data);
                                    const audioBytes = new Uint8Array(binaryString.length);
                                    for (let i = 0; i < binaryString.length; i++) {
                                        audioBytes[i] = binaryString.charCodeAt(i);
                                    }

                                    chunkCount++;
                                    totalBytes += audioBytes.length;

                                    if (isMP3) {
                                        // For MP3, break large chunks into smaller pieces for better progressive playback
                                        // Target: ~64KB sub-chunks for smoother streaming
                                        const SUB_CHUNK_SIZE = 64 * 1024; // 64KB sub-chunks

                                        if (audioBytes.length > SUB_CHUNK_SIZE) {
                                            // Large chunk - split into smaller pieces
                                            let offset = 0;
                                            let subChunkCount = 0;
                                            while (offset < audioBytes.length) {
                                                const subChunk = audioBytes.slice(offset, Math.min(offset + SUB_CHUNK_SIZE, audioBytes.length));

                                                if (firstChunkSentTime === null) {
                                                    firstChunkSentTime = Date.now();
                                                    const timeToFirstChunkSent = firstChunkSentTime - requestStartTime;
                                                    log.debug(`[TTS API] 🎵 First MP3 sub-chunk sent to client: ${timeToFirstChunkSent}ms from request start`);
                                                }

                                                controller.enqueue(subChunk);
                                                offset += SUB_CHUNK_SIZE;
                                                subChunkCount++;
                                            }

                                            // Log progress for split chunks
                                            if (chunkCount <= 5 || chunkCount % 20 === 0) {
                                                const elapsed = Date.now() - streamStartTime;
                                                const rate = (totalBytes / 1024) / (elapsed / 1000);
                                                log.debug(`[TTS API] Chunk ${chunkCount}: ${audioBytes.length} bytes MP3 (split into ${subChunkCount} sub-chunks), total: ${(totalBytes / 1024).toFixed(0)}KB, rate: ${rate.toFixed(2)}KB/s`);
                                            }
                                        } else {
                                            // Small chunk - send as-is
                                            if (firstChunkSentTime === null) {
                                                firstChunkSentTime = Date.now();
                                                const timeToFirstChunkSent = firstChunkSentTime - requestStartTime;
                                                log.debug(`[TTS API] 🎵 First MP3 chunk sent to client: ${timeToFirstChunkSent}ms from request start`);
                                            }

                                            const enqueueStart = Date.now();
                                            controller.enqueue(audioBytes);
                                            const enqueueTime = Date.now() - enqueueStart;

                                            // Log progress
                                            if (chunkCount <= 5 || chunkCount % 50 === 0) {
                                                const elapsed = Date.now() - streamStartTime;
                                                const rate = (totalBytes / 1024) / (elapsed / 1000);
                                                log.debug(`[TTS API] Chunk ${chunkCount}: ${audioBytes.length} bytes MP3, total: ${(totalBytes / 1024).toFixed(0)}KB, rate: ${rate.toFixed(2)}KB/s (enqueue: ${enqueueTime}ms)`);
                                            }
                                        }
                                    } else {
                                        // For PCM, accumulate chunks (need to convert to WAV at the end)
                                        pcmChunks.push(audioBytes);

                                        // Log progress
                                        if (chunkCount <= 5 || chunkCount % 50 === 0) {
                                            const elapsed = Date.now() - streamStartTime;
                                            const rate = (totalBytes / 1024) / (elapsed / 1000);
                                            log.debug(`[TTS API] Chunk ${chunkCount}: ${audioBytes.length} bytes PCM, total: ${(totalBytes / 1024).toFixed(0)}KB, rate: ${rate.toFixed(2)}KB/s`);
                                        }
                                    }
                                }
                            }

                            if (totalBytes === 0) {
                                throw new Error('No audio data received from ElevenLabs');
                            }

                            if (isMP3) {
                                // MP3 chunks already sent, just close the stream
                                controller.close();

                                const streamTime = Date.now() - streamStartTime;
                                const totalTime = Date.now() - requestStartTime;
                                const finalRate = (totalBytes / 1024) / (streamTime / 1000);
                                const avgRate = (totalBytes / 1024) / (totalTime / 1000);

                                log.debug(`[TTS API] ✅ Stream complete: ${chunkCount} MP3 chunks, ${(totalBytes / 1024).toFixed(0)}KB in ${streamTime}ms`);
                                log.debug(`[TTS API] 📊 Performance: ${finalRate.toFixed(2)}KB/s streaming rate, ${avgRate.toFixed(2)}KB/s average`);
                                log.debug(`[TTS API] ⏱️ Total latency: ${totalTime}ms from request start (fetch: ${fetchTime}ms, stream: ${streamTime}ms)`);

                                if (firstChunkTime) {
                                    const timeToFirstAudio = firstChunkTime - requestStartTime;
                                    log.debug(`[TTS API] 🚀 Time to first audio chunk: ${timeToFirstAudio}ms`);
                                }
                            } else {
                                // For PCM, convert all accumulated chunks to WAV
                                const alignedPcmBytes = totalBytes % 2 === 0 ? totalBytes : totalBytes - 1;
                                if (alignedPcmBytes !== totalBytes) {
                                    log.warn(`[TTS API] PCM data length ${totalBytes} is odd, aligning to ${alignedPcmBytes} bytes`);
                                }

                                const pcmData = new Uint8Array(alignedPcmBytes);
                                let offset = 0;
                                let bytesCopied = 0;
                                for (const chunk of pcmChunks) {
                                    const bytesToCopy = Math.min(chunk.length, alignedPcmBytes - bytesCopied);
                                    if (bytesToCopy > 0) {
                                        pcmData.set(chunk.slice(0, bytesToCopy), offset);
                                        offset += bytesToCopy;
                                        bytesCopied += bytesToCopy;
                                    }
                                    if (bytesCopied >= alignedPcmBytes) break;
                                }

                                log.debug(`[TTS API] Converting ${(alignedPcmBytes / 1024).toFixed(0)}KB PCM to WAV (${alignedPcmBytes} bytes, ${alignedPcmBytes / 2} samples)...`);
                                const convertStart = Date.now();
                                const wavData = pcmToWav(pcmData, 44100, 1);
                                const convertTime = Date.now() - convertStart;
                                log.debug(`[TTS API] WAV conversion completed in ${convertTime}ms: ${(wavData.length / 1024).toFixed(0)}KB (header: 44 bytes, data: ${alignedPcmBytes} bytes)`);

                                // Send the complete WAV file
                                const enqueueStart = Date.now();
                                controller.enqueue(wavData);
                                const enqueueTime = Date.now() - enqueueStart;

                                const firstChunkSentTime = Date.now();
                                const timeToFirstChunkSent = firstChunkSentTime - requestStartTime;
                                log.debug(`[TTS API] 🎵 WAV sent to client: ${timeToFirstChunkSent}ms from request start (enqueue: ${enqueueTime}ms)`);

                                controller.close();

                                const streamTime = Date.now() - streamStartTime;
                                const totalTime = Date.now() - requestStartTime;
                                const finalRate = (wavData.length / 1024) / (streamTime / 1000);
                                const avgRate = (wavData.length / 1024) / (totalTime / 1000);

                                log.debug(`[TTS API] ✅ Stream complete: ${chunkCount} PCM chunks, ${(wavData.length / 1024).toFixed(0)}KB WAV in ${streamTime}ms`);
                                log.debug(`[TTS API] 📊 Performance: ${finalRate.toFixed(2)}KB/s streaming rate, ${avgRate.toFixed(2)}KB/s average`);
                                log.debug(`[TTS API] ⏱️ Total latency: ${totalTime}ms from request start (fetch: ${fetchTime}ms, stream: ${streamTime}ms, convert: ${convertTime}ms)`);

                                if (firstChunkTime) {
                                    const timeToFirstAudio = firstChunkTime - requestStartTime;
                                    log.debug(`[TTS API] 🚀 Time to first audio chunk: ${timeToFirstAudio}ms`);
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

