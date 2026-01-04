import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/app/auth';
import { getTTSProvider } from '@/app/services/providers/tts';

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
        const { text } = body;

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

        // Return streaming binary response
        return new Response(audioStream, {
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