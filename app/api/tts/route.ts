import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/app/auth';
import { getTTSProvider } from '@/app/services/providers/tts';
import { uploadAudio, isS3Configured } from '@/app/utils/s3Service';
import { hashTTSInput } from '@/app/utils/textHash';
import { prisma } from '@/app/utils/prisma';

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
        const { text, entryId } = body;

        if (!text || typeof text !== 'string') {
            return NextResponse.json({ error: 'Text is required' }, { status: 400 });
        }

        const ttsProvider = getTTSProvider();
        const audioStream = await ttsProvider.generateSpeechStream(text);

        if (!audioStream) {
            return NextResponse.json(
                { error: 'Failed to generate speech', message: 'No audio stream returned.' },
                { status: 500 }
            );
        }

        // Split stream: one for client, one for buffering (if S3 is configured)
        let playStream = audioStream;
        let cacheStream: ReadableStream<Uint8Array> | null = null;

        if (isS3Configured()) {
            console.log('[TTS API] S3 configured - setting up background upload...');
            // Use tee() to split stream into two identical streams
            const [stream1, stream2] = audioStream.tee();
            playStream = stream1;
            cacheStream = stream2;

            // Buffer and upload to S3 in background (fire-and-forget)
            const bufferStartTime = Date.now();
            Promise.resolve().then(async () => {
                try {
                    console.log('[TTS API] [S3 Upload] Starting background buffer collection...');
                    const chunks: Uint8Array[] = [];
                    const reader = cacheStream!.getReader();
                    let totalLength = 0;
                    let chunkCount = 0;

                    // Collect all chunks
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        if (value) {
                            chunks.push(value);
                            totalLength += value.length;
                            chunkCount++;
                            if (chunkCount <= 5 || chunkCount % 50 === 0) {
                                console.log(`[TTS API] [S3 Upload] Collected chunk ${chunkCount}: ${(totalLength / 1024).toFixed(1)}KB total`);
                            }
                        }
                    }

                    const bufferTime = Date.now() - bufferStartTime;
                    console.log(`[TTS API] [S3 Upload] ✅ Buffer collection completed in ${bufferTime}ms (${chunkCount} chunks, ${(totalLength / 1024).toFixed(1)}KB)`);

                    // Combine chunks into single buffer
                    const combineStartTime = Date.now();
                    const audioBuffer = new Uint8Array(totalLength);
                    let offset = 0;
                    for (const chunk of chunks) {
                        audioBuffer.set(chunk, offset);
                        offset += chunk.length;
                    }
                    const combineTime = Date.now() - combineStartTime;
                    console.log(`[TTS API] [S3 Upload] Buffer combined in ${combineTime}ms`);

                    // Generate hash and S3 key
                    const hashStartTime = Date.now();
                    const voiceId = process.env.CARTESIA_VOICE_ID || '694f9389-aac1-45b6-b726-9d9369183238';
                    const textHash = hashTTSInput(text, voiceId);
                    const s3Key = `audio/${userId}/${textHash}.wav`;
                    const hashTime = Date.now() - hashStartTime;
                    console.log(`[TTS API] [S3 Upload] Generated S3 key: ${s3Key} (hash: ${textHash}, time: ${hashTime}ms)`);

                    // Upload to S3
                    const uploadStartTime = Date.now();
                    console.log(`[TTS API] [S3 Upload] Starting S3 upload (${(audioBuffer.length / 1024).toFixed(1)}KB)...`);
                    await uploadAudio(audioBuffer, s3Key);
                    const uploadTime = Date.now() - uploadStartTime;
                    console.log(`[TTS API] [S3 Upload] ✅ S3 upload completed in ${uploadTime}ms`);

                    // Save S3 key to database
                    if (prisma) {
                        // If entryId provided, save to journal entry
                        if (entryId) {
                            const dbStartTime = Date.now();
                            console.log(`[TTS API] [S3 Upload] Saving S3 key to database for entry ${entryId}...`);
                            try {
                                // First check if entry exists and belongs to user
                                const entry = await prisma.journalEntry.findUnique({
                                    where: { id: entryId },
                                    select: { userId: true },
                                });

                                if (!entry) {
                                    console.warn(`[TTS API] [S3 Upload] ⚠️ Entry ${entryId} not found in database - skipping S3 key save`);
                                } else if (entry.userId !== userId) {
                                    console.warn(`[TTS API] [S3 Upload] ⚠️ Entry ${entryId} does not belong to user ${userId} - skipping S3 key save`);
                                } else {
                                    // Entry exists and belongs to user, update it
                                    await prisma.journalEntry.update({
                                        where: { id: entryId, userId },
                                        data: { audioS3Key: s3Key },
                                    });
                                    const dbTime = Date.now() - dbStartTime;
                                    console.log(`[TTS API] [S3 Upload] ✅ S3 key saved to database in ${dbTime}ms`);
                                }
                            } catch (err: any) {
                                const dbTime = Date.now() - dbStartTime;
                                // Check for Prisma error P2025 (record not found)
                                if (err?.code === 'P2025') {
                                    console.warn(`[TTS API] [S3 Upload] ⚠️ Entry ${entryId} not found (P2025) after ${dbTime}ms - skipping S3 key save`);
                                } else {
                                    console.error(`[TTS API] [S3 Upload] ❌ Failed to save S3 key to entry ${entryId} after ${dbTime}ms:`, err);
                                }
                            }
                        } else {
                            console.log(`[TTS API] [S3 Upload] No entryId provided - skipping database save`);
                        }
                        // Could also save to TTS cache table here if implemented
                    } else {
                        console.log(`[TTS API] [S3 Upload] Prisma not configured - skipping database save`);
                    }

                    const totalTime = Date.now() - bufferStartTime;
                    console.log(`[TTS API] [S3 Upload] ✅ Background upload process completed in ${totalTime}ms total`);
                } catch (error) {
                    const totalTime = Date.now() - bufferStartTime;
                    console.error(`[TTS API] [S3 Upload] ❌ Background S3 upload failed after ${totalTime}ms:`, error);
                    // Don't throw - this is fire-and-forget
                }
            });
        } else {
            console.log('[TTS API] S3 not configured - skipping background upload');
        }

        // Return streaming binary response
        return new Response(playStream, {
            headers: {
                'Content-Type': 'audio/wav', // WAV audio for progressive decoding
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'Transfer-Encoding': 'chunked',
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