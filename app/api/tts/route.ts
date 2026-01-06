import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/app/auth';
import { getTTSProvider } from '@/app/services/providers/tts';
import { uploadAudio, isS3Configured, checkObjectExists, downloadAudio } from '@/app/utils/s3Service';
import { hashTTSInput } from '@/app/utils/textHash';
import { prisma } from '@/app/utils/prisma';
import { moodToFishEmotion, injectFishEmotion } from '@/app/services/providers/tts/fish';
import type { Mood } from '@/app/types';

// Rate limiting configuration
const RATE_LIMIT_PER_MINUTE = 30; // Adjust based on your Cartesia API tier (this constant still makes sense here)
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
        const { text, entryId, mood: moodFromRequest } = body;
        const { searchParams } = new URL(request.url);
        const providerParam = searchParams.get('provider');

        if (!text || typeof text !== 'string') {
            return NextResponse.json({ error: 'Text is required' }, { status: 400 });
        }

        // Get format from query parameter (for Content-Type header)
        const formatParam = searchParams.get('format');
        const skipCache = searchParams.get('skipCache') === 'true';

        // Get mood from request or database
        let mood: Mood | undefined = moodFromRequest;

        // If entryId provided but no mood, query database to get mood from entry
        if (entryId && !mood && prisma) {
            try {
                const entry = await prisma.journalEntry.findUnique({
                    where: { id: entryId },
                    select: { mood: true },
                });
                if (entry?.mood) {
                    mood = entry.mood as Mood;
                    console.log(`[TTS API] Retrieved mood from database for entry ${entryId}: ${mood}`);
                }
            } catch (error) {
                console.warn('[TTS API] Failed to retrieve mood from database:', error);
                // Continue without mood
            }
        }

        // Apply emotion for Fish Audio provider
        let processedText = text;
        const providerType = (providerParam || process.env.TTS_PROVIDER || 'cartesia').toLowerCase();

        if (providerType === 'fish' && mood) {
            const emotion = moodToFishEmotion(mood);
            if (emotion) {
                processedText = injectFishEmotion(text, emotion);
                console.log(`[TTS API] Applied Fish Audio emotion: (${emotion}) for mood: ${mood}`);
            }
        }

        // Generate S3 cache key from text + provider + format
        const cacheKey = `tts_full/${hashTTSInput(processedText + providerType + (formatParam || 'wav'))}.wav`;

        // PHASE 1: Check S3 cache (skip if skipCache=true)
        if (isS3Configured() && !skipCache) {
            const cacheCheckStart = Date.now();
            const cached = await checkObjectExists(cacheKey);
            const cacheCheckTime = Date.now() - cacheCheckStart;

            if (cached) {
                console.log(`[TTS API] ✅ Cache HIT (${cacheCheckTime}ms): ${cacheKey}`);

                // Stream from S3
                const downloadStart = Date.now();
                const audioBuffer = await downloadAudio(cacheKey);
                const downloadTime = Date.now() - downloadStart;

                console.log(`[TTS API] Streamed from S3: ${(audioBuffer.length / 1024).toFixed(1)}KB in ${downloadTime}ms`);

                const stream = new ReadableStream({
                    start(controller) {
                        controller.enqueue(audioBuffer);
                        controller.close();
                    }
                });

                let contentType = 'audio/wav';
                if (formatParam === 'pcm') {
                    contentType = 'audio/L16';
                } else if (formatParam === 'mp3') {
                    contentType = 'audio/mpeg';
                }

                return new Response(stream, {
                    headers: {
                        'Content-Type': contentType,
                        'Cache-Control': 'public, max-age=31536000',
                        'X-Cache-Status': 'HIT',
                        'X-Cache-Time': String(cacheCheckTime),
                        ...(formatParam === 'pcm' ? { 'X-Audio-Sample-Rate': '44100' } : {}),
                    },
                });
            }

            console.log(`[TTS API] Cache MISS (${cacheCheckTime}ms): ${cacheKey}`);
        } else if (skipCache) {
            console.log('[TTS API] Cache SKIPPED (skipCache=true for testing)');
        }

        // PHASE 2: Generate TTS (cache miss or S3 not configured)
        const ttsProvider = getTTSProvider(providerParam || undefined);
        const audioStream = await ttsProvider.generateSpeechStream(processedText);

        if (!audioStream) {
            return NextResponse.json(
                { error: 'Failed to generate speech', message: 'No audio stream returned.' },
                { status: 500 }
            );
        }

        // PHASE 3: Stream to client + buffer for S3 upload (skip upload if skipCache=true)
        // Use TransformStream to buffer chunks while streaming to client
        const chunks: Uint8Array[] = [];
        let totalLength = 0;

        const { readable, writable } = new TransformStream({
            transform(chunk, controller) {
                // Pass through to client immediately
                controller.enqueue(chunk);

                // Buffer for S3 upload (skip if skipCache=true)
                if (isS3Configured() && !skipCache) {
                    chunks.push(new Uint8Array(chunk));
                    totalLength += chunk.length;
                }
            },
            flush() {
                // After streaming completes, upload to S3 in background (skip if skipCache=true)
                if (isS3Configured() && !skipCache && chunks.length > 0) {
                    const buffer = new Uint8Array(totalLength);
                    let offset = 0;
                    for (const chunk of chunks) {
                        buffer.set(chunk, offset);
                        offset += chunk.length;
                    }

                    console.log(`[TTS API] Buffered ${(buffer.length / 1024).toFixed(1)}KB for S3 upload`);

                    // Upload in background (non-blocking)
                    uploadAudio(buffer, cacheKey)
                        .then(() => {
                            console.log(`[TTS API] ✅ Background upload complete: ${cacheKey}`);
                        })
                        .catch((err) => {
                            console.error(`[TTS API] ❌ Background upload failed: ${cacheKey}`, err);
                        });
                }
            }
        });

        // Pipe audio stream through transform
        audioStream.pipeTo(writable).catch(err => {
            console.error('[TTS API] Stream pipe error:', err);
        });

        if (skipCache) {
            console.log('[TTS API] Streaming to client (S3 caching disabled for testing)');
        } else {
            console.log('[TTS API] Streaming to client with background S3 upload');
        }

        // Determine Content-Type
        let contentType = 'audio/wav';
        if (formatParam === 'pcm') {
            contentType = 'audio/L16';
        } else if (formatParam === 'mp3') {
            contentType = 'audio/mpeg';
        }

        // Return streaming response
        return new Response(readable, {
            headers: {
                'Content-Type': contentType,
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'Transfer-Encoding': 'chunked',
                'X-Cache-Status': skipCache ? 'SKIP' : 'MISS',
                ...(formatParam === 'pcm' ? { 'X-Audio-Sample-Rate': '44100' } : {}),
            },
        });
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
                    message: 'TTS service requires payment or quota has been exceeded. Please check your account.',
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