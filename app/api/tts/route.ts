import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI, Modality } from '@google/genai';
import { auth } from '@/app/auth';

// Rate limiting configuration
const RATE_LIMIT_PER_MINUTE = 30; // Adjust based on your Gemini API tier
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

/**
 * Extracts and normalizes base64 audio data from Google GenAI inlineData
 * Handles both data URL format (data:audio/...;base64,...) and raw base64
 */
function extractBase64Audio(audioData: any): string {
    if (typeof audioData !== 'string') {
        throw new Error('Audio data must be a string');
    }

    // Check if it's a data URL (data:audio/...;base64,...)
    if (audioData.startsWith('data:')) {
        const base64Index = audioData.indexOf('base64,');
        if (base64Index !== -1) {
            return audioData.substring(base64Index + 7); // Remove 'base64,' prefix
        }
        // If it's a data URL without base64 prefix, try to extract after comma
        const commaIndex = audioData.indexOf(',');
        if (commaIndex !== -1) {
            return audioData.substring(commaIndex + 1);
        }
    }

    // Already base64 (or should be) - return as-is
    return audioData;
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

        const apiKey = process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY;
        if (!apiKey) {
            return NextResponse.json(
                { error: 'TTS service not configured' },
                { status: 500 }
            );
        }

        const ai = new GoogleGenAI({ apiKey });
        const cleanedContent = cleanTextForTTS(text);

        // Generate speech with retry logic for rate limits
        const maxRetries = 3;
        let lastError: any = null;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                const response = await ai.models.generateContent({
                    model: 'gemini-2.5-flash-preview-tts',
                    contents: [{ parts: [{ text: `Speak warmly and gently: ${cleanedContent}` }] }],
                    config: {
                        responseModalities: [Modality.AUDIO],
                        speechConfig: {
                            voiceConfig: {
                                prebuiltVoiceConfig: { voiceName: 'Kore' },
                            },
                        },
                    },
                });

                const rawAudioData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
                if (!rawAudioData) {
                    throw new Error('No audio data in response');
                }

                // Extract and normalize base64 audio data
                // This handles both data URL format and raw base64
                let audioData = extractBase64Audio(rawAudioData);

                // Remove any whitespace (base64 shouldn't have it, but some APIs add it)
                audioData = audioData.replace(/\s/g, '');

                // Validate that it's valid base64
                if (!audioData || audioData.length === 0) {
                    console.error('[TTS API] Empty audio data after extraction', {
                        rawType: typeof rawAudioData,
                        rawLength: typeof rawAudioData === 'string' ? rawAudioData.length : 'N/A'
                    });
                    throw new Error('Empty audio data after extraction');
                }

                // Basic base64 validation (base64 chars only, with padding)
                const base64Regex = /^[A-Za-z0-9+/]+=*$/;
                if (!base64Regex.test(audioData)) {
                    console.error('[TTS API] Invalid base64 format detected', {
                        length: audioData.length,
                        firstChars: audioData.substring(0, 100),
                        lastChars: audioData.substring(audioData.length - 20),
                        wasDataUrl: typeof rawAudioData === 'string' && rawAudioData.startsWith('data:')
                    });
                    throw new Error('Audio data is not in valid base64 format');
                }

                console.log(`[TTS API] ✅ Successfully generated audio (${audioData.length} chars base64, ~${Math.round(audioData.length * 0.75 / 1024)}KB)`);
                return NextResponse.json({ audioData });
            } catch (error: any) {
                lastError = error;

                // Check if it's a rate limit error
                const errorMessage = error?.message || '';
                const errorStatus = error?.status || error?.code || '';

                const isRateLimit =
                    errorStatus === 429 ||
                    errorMessage.includes('429') ||
                    errorMessage.includes('rate limit') ||
                    errorMessage.includes('quota') ||
                    errorMessage.toLowerCase().includes('resource_exhausted');

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

        // Check if it's a rate limit error
        const errorMessage = error?.message || '';
        const errorStatus = error?.status || error?.code || '';

        const isRateLimit =
            errorStatus === 429 ||
            errorMessage.includes('429') ||
            errorMessage.includes('rate limit') ||
            errorMessage.includes('quota') ||
            errorMessage.toLowerCase().includes('resource_exhausted');

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

