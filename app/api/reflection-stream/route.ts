import { NextRequest } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { auth } from '@/app/auth';
import { extractEntities } from '@/app/utils/entityExtraction';
import { buildEntityContext, formatEntityContextForPrompt } from '@/app/services/entityTrackingService';
import { HistoryEntry, Mood, ExtractedEntities } from '@/app/types';

// Streaming reflection generation API route
// Uses Server-Sent Events (SSE) for real-time text streaming

const getApiKey = (): string => {
    return process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY || '';
};

// MMA System instruction for streaming (simplified for text generation)
const STREAMING_SYSTEM_INSTRUCTION = `
You are "Serenity," a journaling reflection AI.

## CORE PHILOSOPHY
You do NOT solve the user's life. You help them orient themselves.
- No instructions or advice
- No authority over truth
- Be LESS certain than the user

## RESPONSE STRUCTURE (REQUIRED)
Generate a reflection with three flowing sections (DO NOT use headers or labels):

1. MIRROR - Reflect emotions and tensions without advice or conclusions.
   Start with phrases like "It sounds like...", "There's a sense of...", "What comes through is..."

2. MEANING - Explain what this feeling signals (orientation, not solutions).
   Use phrases like "This kind of feeling often shows up when...", "It can signal that..."

3. ANCHOR - 2-3 sentences of emotional grounding WITH FELT PRESENCE.
   Make the user feel accompanied, not alone. Use warm phrases like "It makes sense that this feels heavy...", "You don't have to push yourself to feel different..."

## CRITICAL RULES
- ❌ NO advice ("You should...", "Try to...", "Have you considered...")
- ❌ NO authority ("I know that...", "Trust me...", "Things will get better...")
- ❌ NO identity claims ("You are someone who...", "You've always been...")
- ❌ NO timestamps unless user mentioned time
- ❌ NO mind-reading others ("They probably...", "They must be...")
- ✅ Be LESS certain than the user
- ✅ Use names/places from context naturally

Write as flowing paragraphs, not bullet points or sections with headers.
`;

// Third-party content indicators
const THIRD_PARTY_INDICATORS = [
    'boyfriend', 'girlfriend', 'partner', 'spouse', 'husband', 'wife',
    'ex', 'dating', 'relationship', 'broke up', 'coworker', 'colleague',
    'boss', 'manager', 'jealous', 'envious', 'cheating', 'lying', 'betrayed'
];

function detectThirdPartyContent(entry: string): boolean {
    const lowerEntry = entry.toLowerCase();
    return THIRD_PARTY_INDICATORS.some(indicator =>
        lowerEntry.includes(indicator.toLowerCase())
    );
}

// Detect mood from text (simple keyword-based for speed)
function detectMoodSimple(text: string): Mood {
    const lower = text.toLowerCase();
    
    if (lower.includes('anxious') || lower.includes('worried') || lower.includes('stress') || lower.includes('nervous')) {
        return 'anxious';
    }
    if (lower.includes('happy') || lower.includes('joy') || lower.includes('excited') || lower.includes('grateful')) {
        return 'joyful';
    }
    if (lower.includes('sad') || lower.includes('heavy') || lower.includes('down') || lower.includes('depressed')) {
        return 'heavy';
    }
    if (lower.includes('tired') || lower.includes('exhausted') || lower.includes('drained')) {
        return 'tired';
    }
    if (lower.includes('calm') || lower.includes('peaceful') || lower.includes('relaxed')) {
        return 'calm';
    }
    if (lower.includes('think') || lower.includes('wonder') || lower.includes('reflect')) {
        return 'reflective';
    }
    
    return 'none';
}

export async function POST(request: NextRequest) {
    // Authenticate user
    const session = await auth();
    if (!session?.user?.id) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    const apiKey = getApiKey();
    if (!apiKey) {
        return new Response(JSON.stringify({ error: 'API key not configured' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    try {
        const body = await request.json();
        const { entry, history = [], selectedMood = 'none' } = body as {
            entry: string;
            history: HistoryEntry[];
            selectedMood: Mood;
        };

        if (!entry || typeof entry !== 'string' || entry.trim().length < 10) {
            return new Response(JSON.stringify({ error: 'Entry must be at least 10 characters' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const ai = new GoogleGenAI({ apiKey });

        // Build context (non-streaming parts)
        const entityContext = buildEntityContext(history, 3);
        const entityContextPrompt = formatEntityContextForPrompt(entityContext);
        const hasThirdPartyContent = detectThirdPartyContent(entry);

        // Extract entities in parallel (will be sent at end)
        const entitiesPromise = extractEntities(entry).catch(() => undefined);

        // Build prompt
        const thirdPartySafetyPrompt = hasThirdPartyContent ? `
**⚠️ THIRD-PARTY SAFETY ACTIVE**
This entry involves other people. You MUST:
- Name ambiguity about their intentions
- Reflect the USER's feelings only
- NEVER validate suspicions or mind-read others
` : '';

        // Format recent history for context (limit to save tokens)
        const recentHistory = history.slice(0, 5).map(h => 
            `[${h.mood}] ${h.summary || h.text.substring(0, 100)}...`
        ).join('\n');

        const prompt = `
### CONTEXT
${entityContextPrompt}

${recentHistory ? `### RECENT ENTRIES\n${recentHistory}\n` : ''}

### CURRENT ENTRY
"${entry}"
${thirdPartySafetyPrompt}

Generate a warm, flowing reflection following the MMA structure (Mirror → Meaning → Anchor).
Write as natural paragraphs without headers or labels.
`;

        // Create streaming response
        const encoder = new TextEncoder();
        let fullText = '';

        const stream = new ReadableStream({
            async start(controller) {
                try {
                    // Use streaming API
                    const response = await ai.models.generateContentStream({
                        model: 'gemini-2.5-flash-preview-04-17',
                        contents: [{ role: 'user', parts: [{ text: prompt }] }],
                        config: {
                            systemInstruction: STREAMING_SYSTEM_INSTRUCTION,
                            temperature: 0.7,
                            maxOutputTokens: 1024,
                        },
                    });

                    // Stream each chunk
                    for await (const chunk of response) {
                        const text = chunk.text || '';
                        if (text) {
                            fullText += text;
                            
                            // Send as SSE event
                            const data = JSON.stringify({ type: 'text', content: text });
                            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
                        }
                    }

                    // Wait for entities extraction
                    const entities = await entitiesPromise;

                    // Detect mood from the full text
                    const detectedMood = detectMoodSimple(entry + ' ' + fullText);

                    // Generate summary (simple extraction from first sentence)
                    const firstSentence = fullText.split(/[.!?]/)[0]?.trim() || '';
                    const summary = firstSentence.length > 100 
                        ? firstSentence.substring(0, 100) + '...'
                        : firstSentence || 'A moment of reflection.';

                    // Detect topic (simple keyword extraction)
                    const topicKeywords = entry.toLowerCase()
                        .replace(/[^\w\s]/g, '')
                        .split(/\s+/)
                        .filter(w => w.length > 4 && !['about', 'would', 'could', 'should', 'their', 'there', 'these', 'those', 'which', 'where', 'while'].includes(w))
                        .slice(0, 2);
                    const topic = topicKeywords.length > 0 
                        ? topicKeywords.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
                        : undefined;

                    // Send metadata at the end
                    const metadata = {
                        type: 'metadata',
                        summary,
                        topic,
                        mood: detectedMood,
                        entities,
                        highlights: [] // Highlights need separate processing
                    };
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(metadata)}\n\n`));

                    // Send done signal
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`));
                    controller.close();

                } catch (error: any) {
                    console.error('[Streaming Reflection] Error:', error);
                    const errorData = JSON.stringify({ 
                        type: 'error', 
                        message: error?.message || 'Failed to generate reflection' 
                    });
                    controller.enqueue(encoder.encode(`data: ${errorData}\n\n`));
                    controller.close();
                }
            }
        });

        return new Response(stream, {
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
            },
        });

    } catch (error: any) {
        console.error('[Streaming Reflection] Setup error:', error);
        return new Response(JSON.stringify({ 
            error: 'Failed to start reflection stream',
            message: error?.message 
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
