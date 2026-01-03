'use client';

import { useState, useCallback, useRef } from 'react';
import { HistoryEntry, Mood, ExtractedEntities, Highlight } from '../types';

export interface StreamingReflectionState {
    // Streaming state
    isStreaming: boolean;
    streamedText: string;
    
    // Final result (after streaming completes)
    reflection: string | null;
    summary: string | null;
    topic: string | undefined;
    mood: Mood | undefined;
    entities: ExtractedEntities | undefined;
    highlights: Highlight[];
    
    // Error state
    error: string | null;
}

export interface UseStreamingReflectionReturn extends StreamingReflectionState {
    startStreaming: (entry: string, history: HistoryEntry[], selectedMood: Mood) => Promise<void>;
    stopStreaming: () => void;
    reset: () => void;
}

const initialState: StreamingReflectionState = {
    isStreaming: false,
    streamedText: '',
    reflection: null,
    summary: null,
    topic: undefined,
    mood: undefined,
    entities: undefined,
    highlights: [],
    error: null,
};

/**
 * React hook for streaming reflection generation
 * Provides real-time text updates as the AI generates the reflection
 */
export function useStreamingReflection(): UseStreamingReflectionReturn {
    const [state, setState] = useState<StreamingReflectionState>(initialState);
    const abortControllerRef = useRef<AbortController | null>(null);

    const reset = useCallback(() => {
        // Abort any ongoing stream
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }
        setState(initialState);
    }, []);

    const stopStreaming = useCallback(() => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }
        setState(prev => ({ ...prev, isStreaming: false }));
    }, []);

    const startStreaming = useCallback(async (
        entry: string,
        history: HistoryEntry[],
        selectedMood: Mood
    ) => {
        // Reset state and create new abort controller
        reset();
        abortControllerRef.current = new AbortController();

        setState(prev => ({
            ...prev,
            isStreaming: true,
            streamedText: '',
            error: null,
        }));

        try {
            const response = await fetch('/api/reflection-stream', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    entry,
                    history,
                    selectedMood,
                }),
                signal: abortControllerRef.current.signal,
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || errorData.message || `HTTP ${response.status}`);
            }

            if (!response.body) {
                throw new Error('No response body');
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let fullText = '';

            while (true) {
                const { done, value } = await reader.read();
                
                if (done) break;

                // Decode chunk and add to buffer
                buffer += decoder.decode(value, { stream: true });

                // Process complete SSE events
                const lines = buffer.split('\n\n');
                buffer = lines.pop() || ''; // Keep incomplete event in buffer

                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;

                    try {
                        const data = JSON.parse(line.slice(6)); // Remove 'data: ' prefix

                        switch (data.type) {
                            case 'text':
                                // Append streamed text
                                fullText += data.content;
                                setState(prev => ({
                                    ...prev,
                                    streamedText: fullText,
                                }));
                                break;

                            case 'metadata':
                                // Received final metadata
                                setState(prev => ({
                                    ...prev,
                                    summary: data.summary,
                                    topic: data.topic,
                                    mood: data.mood,
                                    entities: data.entities,
                                    highlights: data.highlights || [],
                                }));
                                break;

                            case 'done':
                                // Streaming complete
                                setState(prev => ({
                                    ...prev,
                                    isStreaming: false,
                                    reflection: fullText,
                                }));
                                break;

                            case 'error':
                                throw new Error(data.message || 'Streaming error');
                        }
                    } catch (parseError) {
                        console.warn('[useStreamingReflection] Failed to parse SSE event:', line);
                    }
                }
            }

            // Ensure final state is set
            setState(prev => ({
                ...prev,
                isStreaming: false,
                reflection: fullText || prev.reflection,
            }));

        } catch (error: any) {
            // Don't report abort errors
            if (error.name === 'AbortError') {
                setState(prev => ({ ...prev, isStreaming: false }));
                return;
            }

            console.error('[useStreamingReflection] Error:', error);
            setState(prev => ({
                ...prev,
                isStreaming: false,
                error: error.message || 'Failed to generate reflection',
            }));
        }
    }, [reset]);

    return {
        ...state,
        startStreaming,
        stopStreaming,
        reset,
    };
}

/**
 * Utility to fetch streaming reflection without React hook
 * Useful for non-React contexts or manual control
 */
export async function* streamReflection(
    entry: string,
    history: HistoryEntry[],
    selectedMood: Mood,
    signal?: AbortSignal
): AsyncGenerator<{
    type: 'text' | 'metadata' | 'done' | 'error';
    content?: string;
    metadata?: {
        summary: string;
        topic?: string;
        mood?: Mood;
        entities?: ExtractedEntities;
        highlights?: Highlight[];
    };
    error?: string;
}> {
    const response = await fetch('/api/reflection-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entry, history, selectedMood }),
        signal,
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        yield { type: 'error', error: errorData.error || `HTTP ${response.status}` };
        return;
    }

    if (!response.body) {
        yield { type: 'error', error: 'No response body' };
        return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
            if (!line.startsWith('data: ')) continue;

            try {
                const data = JSON.parse(line.slice(6));

                switch (data.type) {
                    case 'text':
                        yield { type: 'text', content: data.content };
                        break;
                    case 'metadata':
                        yield { 
                            type: 'metadata', 
                            metadata: {
                                summary: data.summary,
                                topic: data.topic,
                                mood: data.mood,
                                entities: data.entities,
                                highlights: data.highlights,
                            }
                        };
                        break;
                    case 'done':
                        yield { type: 'done' };
                        break;
                    case 'error':
                        yield { type: 'error', error: data.message };
                        break;
                }
            } catch {
                // Skip invalid JSON
            }
        }
    }
}
