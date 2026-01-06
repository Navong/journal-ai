'use client';

import React, { useState, useRef, useCallback } from 'react';
import { ChatMessage } from '../types';
import { startJournalChat } from '../services/journalAIService';
import { generateSpeech } from '../utils/audioGeneration';
import { audioCache } from '../utils/audioCache';
import { showToast } from '../utils/toast';
import { withRetry } from '../utils/retry';
import { ChatSession } from '../services/providers/llm/interface';

interface ChatManagerProps {
    entry: string;
    reflection: { content: string; topic: string } | null;
    history: any[];
    selectedMood: string;
    autoPlayEnabled: boolean;
    onMessagesChange: (messages: ChatMessage[]) => void;
    onSendingChange: (sending: boolean) => void;
    onContextRevalidatedChange: (revalidated: boolean) => void;
    children: (props: {
        chatMessages: ChatMessage[];
        isSendingChat: boolean;
        contextRevalidated: boolean;
        onSendMessage: (text: string) => Promise<void>;
        onClearChat: () => void;
        onInvalidateChatSession: () => void;
    }) => React.ReactNode;
}

export const ChatManager: React.FC<ChatManagerProps> = ({
    entry,
    reflection,
    history,
    selectedMood,
    autoPlayEnabled,
    onMessagesChange,
    onSendingChange,
    onContextRevalidatedChange,
    children
}) => {
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
    const [isSendingChat, setIsSendingChat] = useState(false);
    const [contextRevalidated, setContextRevalidated] = useState(false);
    const chatSessionRef = useRef<ChatSession | null>(null);

    // Update parent state when messages change
    const updateMessages = useCallback((messages: ChatMessage[]) => {
        setChatMessages(messages);
        onMessagesChange(messages);
    }, [onMessagesChange]);

    // Update sending state
    const updateSendingState = useCallback((sending: boolean) => {
        setIsSendingChat(sending);
        onSendingChange(sending);
    }, [onSendingChange]);

    // Update context revalidated state
    const updateContextRevalidated = useCallback((revalidated: boolean) => {
        setContextRevalidated(revalidated);
        onContextRevalidatedChange(revalidated);
    }, [onContextRevalidatedChange]);

    // Send chat message
    const handleSendMessage = useCallback(async (text: string) => {
        if (!chatSessionRef.current) {
            if (!reflection) return;
            // Always use the latest history state to ensure deleted entries are excluded
            chatSessionRef.current = await startJournalChat(entry, reflection.content, selectedMood, history, reflection.topic);
            // Clear context revalidation indicator when session is recreated
            if (contextRevalidated) {
                updateContextRevalidated(false);
                showToast('Context refreshed with updated history', 'success');
            }
        }

        const newUserMsg: ChatMessage = { role: 'user', text };
        const updatedMessagesWithUser = [...chatMessages, newUserMsg];
        updateMessages(updatedMessagesWithUser);
        updateSendingState(true);

        try {
            const response = await chatSessionRef.current!.sendMessage(text);
            const modelText = response || "I'm here listening, but I couldn't find the right words just now.";
            const newModelMsg: ChatMessage = { role: 'model', text: modelText };

            const updatedMessagesWithModel = [...updatedMessagesWithUser, newModelMsg];
            updateMessages(updatedMessagesWithModel);

            // Only auto-generate audio for chat messages if auto-play is enabled
            if (autoPlayEnabled) {
                try {
                    // Check cache first
                    const cached = await audioCache.get(modelText);
                    if (cached) {
                        const audioData = typeof cached === 'string' ? cached : [cached];
                        const newMessages = [...updatedMessagesWithModel];
                        const lastIdx = newMessages.length - 1;
                        if (newMessages[lastIdx] && newMessages[lastIdx].role === 'model') {
                            newMessages[lastIdx] = { ...newMessages[lastIdx], audioBase64: audioData };
                        }
                        updateMessages(newMessages);
                    } else {
                        // Generate with chunking
                        const needsChunking = modelText.length > 1500;
                        const audioResult = await withRetry(
                            'generate-tts-chat-model',
                            () => generateSpeech(modelText, {
                                chunked: needsChunking
                            }),
                            3,
                            2000
                        );

                        if (audioResult) {
                            const audioData = Array.isArray(audioResult) ? audioResult : [audioResult];
                            const newMessages = [...updatedMessagesWithModel];
                            const lastIdx = newMessages.length - 1;
                            if (newMessages[lastIdx] && newMessages[lastIdx].role === 'model') {
                                newMessages[lastIdx] = { ...newMessages[lastIdx], audioBase64: audioData };
                            }
                            updateMessages(newMessages);

                            // Cache the audio
                            if (typeof audioResult === 'string') {
                                await audioCache.set(modelText, audioResult);
                            }
                        } else {
                            showToast('Could not generate audio automatically.', 'error');
                        }
                    }
                } catch (error) {
                    console.error('Auto TTS generation error:', error);
                    showToast('Error generating speech automatically.', 'error');
                }
            }
        } catch (err: any) {
            console.error(err);

            // Parse API error to show user-friendly message
            let errorMessage = "I'm sorry, I lost my train of thought. Could you say that again?";
            let toastMessage = "I'm sorry, I couldn't respond right now. Please try again.";

            if (err?.error?.code === 429 || err?.status === 429 || err?.error?.status === 'RESOURCE_EXHAUSTED') {
                const retryDelay = err?.error?.details?.find((d: any) => d?.['@type']?.includes('RetryInfo'))?.retryDelay ||
                    err?.error?.message?.match(/retry in ([\d.]+)s/)?.[1];

                if (retryDelay) {
                    const seconds = Math.ceil(parseFloat(retryDelay));
                    toastMessage = `Rate limit exceeded. Please wait ${seconds} seconds before trying again.`;
                    errorMessage = `I hit a rate limit. Please wait ${seconds} seconds and try again.`;
                } else {
                    toastMessage = 'Rate limit exceeded. Please wait a moment and try again.';
                    errorMessage = 'I hit a rate limit. Please wait a moment and try again.';
                }
                showToast(toastMessage, 'error');
            } else if (err?.message) {
                toastMessage = err.message;
                showToast(toastMessage, 'error');
            } else {
                showToast(toastMessage, 'error');
            }

            const errorMessages = [...chatMessages, { role: 'model' as const, text: errorMessage }];
            updateMessages(errorMessages);
        } finally {
            updateSendingState(false);
        }
    }, [entry, reflection, history, selectedMood, autoPlayEnabled, chatMessages, contextRevalidated, updateMessages, updateSendingState, updateContextRevalidated]);

    // Clear chat
    const clearChat = useCallback(() => {
        updateMessages([]);
        chatSessionRef.current = null;
        updateContextRevalidated(false);
    }, [updateMessages, updateContextRevalidated]);

    // Invalidate chat session (for when history changes)
    const invalidateChatSession = useCallback(() => {
        if (chatSessionRef.current) {
            chatSessionRef.current = null;
            updateContextRevalidated(true);
        }
    }, [updateContextRevalidated]);

    return (
        <>
            {children({
                chatMessages,
                isSendingChat,
                contextRevalidated,
                onSendMessage: handleSendMessage,
                onClearChat: clearChat,
                onInvalidateChatSession: invalidateChatSession,
            })}
        </>
    );
};