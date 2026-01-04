import { NextRequest, NextResponse } from 'next/server';
import { CartesiaClient } from '@cartesia/cartesia-js';
import { auth } from '@/app/auth';

// Rate limiting configuration
const RATE_LIMIT_PER_MINUTE = 30; // Adjust based on your Cartesia API tier
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute

// Simple in-memory rate limiter (use Redis in production)
interface RateLimitEntry {
    count: number;
    resetAt: number;
}

const rateLimitMap = new Map<string, RateLimitEntry>();

function checkRateLimit(identifier: string): { allowed: boolean; retryAfter?: number } {
    const now = Date.now();
    const entry = rateLimitMap.get(identifier);

    if (!entry || now > entry.resetAt) {
        // Reset or create new entry
        rateLimitMap.set(identifier, {
            count: 1,
            resetAt: now + RATE_LIMIT_WINDOW_MS,
        });
        return { allowed: true };
    }

    if (entry.count >= RATE_LIMIT_PER_MINUTE) {
        const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
        return { allowed: false, retryAfter };
    }

    entry.count++;
    return { allowed: true };
}

function cleanTextForTTS(text: string): string {
    return text
        .replace(/[#*`_~]/g, '')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/- /g, '')
        .replace(/\n+/g, ' ')
        .trim();
}

export async function POST(request: NextRequest) {
    // Authenticate user
    const session = await auth();
    if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.id;

    // Rate limit per user
    const rateLimit = checkRateLimit(`user:${userId}`);
    if (!rateLimit.allowed) {
        return NextResponse.json(
            {
                error: 'Rate limit exceeded',
                message: 'Too many TTS requests. Please try again later.',
                retryAfter: rateLimit.retryAfter,
            },
            { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfter) } }
        );
    }

    try {
        const body = await request.json();
        const { text } = body;

        if (!text || typeof text !== 'string') {
            return NextResponse.json({ error: 'Text is required' }, { status: 400 });
        }

        const apiKey = process.env.CARTESIA_API_KEY;
        if (!apiKey) {
            return NextResponse.json(
                { error: 'TTS service not configured' },
                { status: 500 }
            );
        }

        const client = new CartesiaClient({ apiKey });
        const cleanedContent = cleanTextForTTS(text);

        // Get voice ID from environment or use default
        const voiceId = process.env.CARTESIA_VOICE_ID || '694f9389-aac1-45b6-b726-9d9369183238';

        // Generate speech with retry logic for rate limits
        const maxRetries = 3;
        let lastError: any = null;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                const ttsStartTime = Date.now();
                console.log(`[TTS API] Starting TTS generation (attempt ${attempt + 1}/${maxRetries})...`);

                const outputFormat = {
                    container: 'wav' as const,
                    encoding: 'pcm_f32le' as const, // PCM float32 little-endian - allows progressive decoding
                    sampleRate: 44100, // CD quality - matches Cartesia docs recommendation
                };
                console.log('[TTS API] Using output format:', outputFormat);

                const response = await client.tts.bytes({
                    modelId: 'sonic-2',
                    transcript: cleanedContent,
                    voice: {
                        mode: 'id',
                        id: voiceId,
                    },
                    language: 'en',
                    outputFormat,
                    speed: 'slow', // Slower pace for more natural, relaxed listening
                });

                const ttsResponseTime = Date.now() - ttsStartTime;
                console.log(`[TTS API] TTS API response received in ${ttsResponseTime}ms`);

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
                                    // Direct buffer - wrap in a simple stream
                                    const buffer = response instanceof ArrayBuffer ? response : new Uint8Array(response).buffer;
                                    const stream = new ReadableStream({
                                        start(ctrl) {
                                            ctrl.enqueue(new Uint8Array(buffer));
                                            ctrl.close();
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
                            console.log(`[TTS API] Stream reader obtained, starting to read chunks...`);

                            // Read and stream binary chunks as they arrive
                            while (true) {
                                const chunkReceiveStart = Date.now();
                                const { done, value } = await streamReader.read();
                                const chunkReceiveTime = Date.now() - chunkReceiveStart;

                                if (done) break;

                                if (value) {
                                    if (firstChunkTime === null) {
                                        firstChunkTime = Date.now();
                                        console.log(`[TTS API] First chunk received from Cartesia in ${firstChunkTime - streamStartTime}ms (${value.length} bytes, read took ${chunkReceiveTime}ms)`);
                                    }

                                    // Send binary chunk directly to client immediately
                                    const sendStart = Date.now();
                                    controller.enqueue(value);
                                    const sendTime = Date.now() - sendStart;

                                    if (chunkCount === 0) {
                                        const firstChunkSentTime = Date.now();
                                        console.log(`[TTS API] First chunk sent to client in ${firstChunkSentTime - streamStartTime}ms (enqueue took ${sendTime}ms)`);
                                    }

                                    totalBytes += value.length;
                                    chunkCount++;

                                    // Log every chunk for first 5 chunks, then every 10 or every 100KB
                                    if (chunkCount <= 5 || chunkCount % 10 === 0 || totalBytes % (100 * 1024) < value.length) {
                                        const elapsed = Date.now() - streamStartTime;
                                        const rate = (totalBytes / 1024) / (elapsed / 1000);
                                        console.log(`[TTS API] Chunk ${chunkCount}: ${value.length} bytes, total: ${(totalBytes / 1024).toFixed(0)}KB, rate: ${rate.toFixed(2)}KB/s (read: ${chunkReceiveTime}ms, send: ${sendTime}ms)`);
                                    }
                                }
                            }

                            controller.close();

                            const totalTime = Date.now() - streamStartTime;
                            console.log(`[TTS API] ✅ Streamed ${totalBytes} bytes to client in ${totalTime}ms (${chunkCount} chunks, ${(totalBytes / 1024 / (totalTime / 1000)).toFixed(2)}KB/s)`);

                            // Release reader if needed
                            if (streamReader && 'releaseLock' in streamReader) {
                                streamReader.releaseLock();
                            }
                        } catch (error: any) {
                            console.error('[TTS API] Stream error:', error);
                            controller.error(error);
                            throw error;
                        }
                    }
                });

                // Return streaming binary response
                return new Response(stream, {
                    headers: {
                        'Content-Type': 'audio/wav', // WAV audio format
                        'Cache-Control': 'no-cache',
                        'Connection': 'keep-alive',
                        'Transfer-Encoding': 'chunked',
                    },
                });
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
                    console.error('[TTS API] Payment/quota error:', {
                        status: errorStatus,
                        message: errorMessage,
                    });
                    throw new Error('TTS service payment/quota issue. Please check your Cartesia account.');
                }

                if (isRateLimit && attempt < maxRetries - 1) {
                    // Exponential backoff: 2^attempt seconds
                    const waitTime = Math.pow(2, attempt) * 1000;
                    console.warn(`[TTS API] Rate limit hit, retrying after ${waitTime}ms (attempt ${attempt + 1}/${maxRetries})`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                    continue;
                }

                // If not a rate limit error or last attempt, throw
                if (!isRateLimit || attempt === maxRetries - 1) {
                    throw error;
                }
            }
        }

        throw lastError || new Error('Failed to generate speech');
    } catch (error: any) {
        console.error('[TTS API] Error:', error);

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

        if (isPaymentError) {
            return NextResponse.json(
                {
                    error: 'Payment required',
                    message: 'TTS service requires payment or quota has been exceeded. Please check your Cartesia account.',
                },
                { status: 402 }
            );
        }

        if (isRateLimit) {
            return NextResponse.json(
                {
                    error: 'Rate limit exceeded',
                    message: 'TTS service is temporarily unavailable. Please try again in a moment.',
                },
                { status: 429, headers: { 'Retry-After': '60' } }
            );
        }

        return NextResponse.json(
            {
                error: 'Failed to generate speech',
                message: error?.message || 'Unknown error',
            },
            { status: 500 }
        );
    }
}

