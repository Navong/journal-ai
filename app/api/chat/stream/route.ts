import { NextRequest, NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/auth';

export async function POST(req: NextRequest) {
  try {
    // Check authentication
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const { message, context, systemInstruction } = await req.json();

    if (!message || typeof message !== 'string') {
      return NextResponse.json(
        { error: 'Invalid message' },
        { status: 400 }
      );
    }

    const apiKey = process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'API key not configured' },
        { status: 500 }
      );
    }

    const genAI = new GoogleGenAI({ apiKey });
    const model = genAI.getGenerativeModel({ model: 'gemini-3-flash-preview' });

    // Create a ReadableStream for Server-Sent Events
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Build the full prompt with context
          const fullPrompt = context
            ? `${context}\n\nUser message: ${message}`
            : message;

          const result = await model.streamGenerateContent({
            contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
            config: {
              systemInstruction: systemInstruction,
              temperature: 0.7,
            },
          });

          // Stream chunks as they arrive
          for await (const chunk of result.stream) {
            const text = chunk.text();
            if (text) {
              const data = `data: ${JSON.stringify({ text })}\n\n`;
              controller.enqueue(encoder.encode(data));
            }
          }

          // Send final done message
          const doneMessage = `data: ${JSON.stringify({ done: true })}\n\n`;
          controller.enqueue(encoder.encode(doneMessage));

          controller.close();
        } catch (error: any) {
          console.error('Streaming error:', error);
          const errorMessage = `data: ${JSON.stringify({
            error: error.message || 'Error generating response'
          })}\n\n`;
          controller.enqueue(encoder.encode(errorMessage));
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error: any) {
    console.error('Chat stream API error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
