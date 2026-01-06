'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { AudioStreamPlayer, AudioFormat } from '../utils/audioStreamPlayer';
import { generateSpeech, streamToBase64 } from '../utils/audioGeneration';
import { generateSpeechStream } from '../services/journalAIService';
import { audioCache } from '../utils/audioCache';
import { optimizeAudio } from '../utils/audioOptimization';
import { syncAudioToDatabase, shouldRunSync, getSyncState, AudioSyncProgress } from '../utils/audioSync';
import { historyService } from '../services/historyService';
import { showToast } from '../utils/toast';
import { withRetry } from '../utils/retry';

interface AudioManagerProps {
    userId: string | null;
    isDemoMode: boolean;
    autoPlayEnabled: boolean;
    children: (props: AudioManagerRenderProps) => React.ReactNode;
}

export interface AudioManagerRenderProps {
    // State
    isPlayingAudio: boolean;
    playbackRate: number;
    activeAudioId: string | number | null;
    generatingAudioId: string | number | null;
    isGeneratingVoice: boolean;
    audioSyncProgress: AudioSyncProgress | null;
    isAudioSyncing: boolean;

    // Actions
    playAudio: (audioData: string | string[] | Response, id?: string | number, format?: AudioFormat) => Promise<void>;
    stopCurrentAudio: () => void;
    setPlaybackSpeed: (rate: number) => void;
    handleTogglePlayback: (text: string, id?: string) => Promise<void>;
    handleHistoryAudioPlayback: (text: string, id: string) => Promise<void>;
    handleToggleChatPlayback: (text: string, index: number) => Promise<void>;
}

const decodeBase64 = (base64: string) => {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
};

const isCompressedAudio = (base64Audio: string): boolean => {
    try {
        const sample = base64Audio.substring(0, Math.min(100, base64Audio.length));
        const binaryString = atob(sample);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }

        if (bytes.length >= 4) {
            if (bytes[0] === 0x1A && bytes[1] === 0x45 && bytes[2] === 0xDF && bytes[3] === 0xA3) {
                return true; // WebM
            }
            if ((bytes[0] === 0xFF && (bytes[1] === 0xFB || bytes[1] === 0xF3)) ||
                (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33)) {
                return true; // MP3
            }
            if (bytes[0] === 0x4F && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) {
                return true; // OGG
            }
            if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
                return true; // WAV
            }
        }
    } catch (e) {
        console.warn('Could not detect audio format, assuming PCM:', e);
    }
    return false;
};

const getAudioMimeType = (base64Audio: string): string => {
    try {
        const sample = base64Audio.substring(0, Math.min(100, base64Audio.length));
        const binaryString = atob(sample);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }

        if (bytes.length >= 4) {
            if (bytes[0] === 0x1A && bytes[1] === 0x45 && bytes[2] === 0xDF && bytes[3] === 0xA3) {
                return 'audio/webm';
            }
            if ((bytes[0] === 0xFF && (bytes[1] === 0xFB || bytes[1] === 0xF3)) ||
                (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33)) {
                return 'audio/mpeg';
            }
            if (bytes[0] === 0x4F && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) {
                return 'audio/ogg';
            }
            if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
                return 'audio/wav';
            }
        }
    } catch (e) {
        // Default to webm
    }
    return 'audio/webm';
};

export const AudioManager: React.FC<AudioManagerProps> = ({
    userId,
    isDemoMode,
    autoPlayEnabled,
    children
}) => {
    // AudioStreamPlayer ref for Response-based streaming
    const audioPlayerRef = useRef<AudioStreamPlayer | null>(null);
    const [isPlayingAudio, setIsPlayingAudio] = useState(false);
    const [playbackRate, setPlaybackRateState] = useState(1.0);
    const [activeAudioId, setActiveAudioId] = useState<string | number | null>(null);

    // Legacy refs for backward compatibility with base64 audio
    const audioContextRef = useRef<AudioContext | null>(null);
    const currentAudioSourceRef = useRef<AudioBufferSourceNode | null>(null);
    const [currentAudioBase64, setCurrentAudioBase64] = useState<string | string[] | null>(null);
    const [isGeneratingVoice, setIsGeneratingVoice] = useState(false);
    const [generatingAudioId, setGeneratingAudioId] = useState<string | number | null>(null);

    const [audioSyncProgress, setAudioSyncProgress] = useState<AudioSyncProgress | null>(null);
    const [isAudioSyncing, setIsAudioSyncing] = useState(false);
    const audioSyncRef = useRef(false);
    const audioChunksRef = useRef<string[]>([]);
    const currentChunkIndexRef = useRef<number>(0);
    const shouldContinuePlayingRef = useRef<boolean>(false);
    const currentPlaybackIdRef = useRef<string | number | null>(null);
    const playbackSessionIdRef = useRef<number>(0);

    const playAudioChunk = async (
        base64Audio: string,
        id: string | number,
        onComplete?: () => void,
        sessionId?: number
    ): Promise<void> => {
        try {
            let ctx = audioContextRef.current;

            if (!ctx) {
                ctx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
                audioContextRef.current = ctx;
                console.log('[playAudioChunk] AudioContext created, state:', ctx.state);
            }

            const ctxState = ctx.state as string;
            if (ctxState === 'suspended' || ctxState === 'interrupted') {
                const stateMsg = ctxState === 'interrupted' ? 'interrupted (system event)' : 'suspended';
                console.log(`[playAudioChunk] AudioContext ${stateMsg}, attempting to resume...`);
                try {
                    await ctx.resume();
                    console.log('[playAudioChunk] AudioContext resumed, new state:', ctx.state);
                } catch (resumeError) {
                    console.error('[playAudioChunk] Failed to resume AudioContext:', resumeError);
                    throw new Error('Failed to initialize audio. Please try again.');
                }
            }

            console.log('[playAudioChunk] AudioContext ready, state:', ctx.state);

            let buffer: AudioBuffer;
            try {
                const audioBytes = decodeBase64(base64Audio);
                const mimeType = getAudioMimeType(base64Audio);
                console.log(`[playAudioChunk] Decoding compressed audio as ${mimeType}`);
                const audioBlob = new Blob([audioBytes], { type: mimeType });
                const arrayBuffer = await audioBlob.arrayBuffer();
                buffer = await ctx.decodeAudioData(arrayBuffer);
                console.log(`[playAudioChunk] Successfully decoded compressed audio: ${buffer.duration.toFixed(2)}s, ${buffer.sampleRate}Hz`);
            } catch (decodeError) {
                console.error('[playAudioChunk] Failed to decode compressed audio:', decodeError);
                throw new Error('Failed to decode audio');
            }

            const source = ctx.createBufferSource();
            source.buffer = buffer;
            source.playbackRate.value = playbackRate;

            const gainNode = ctx.createGain();
            gainNode.gain.value = 1.0;
            source.connect(gainNode);
            gainNode.connect(ctx.destination);

            return new Promise<void>((resolve) => {
                const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
                    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

                const timingInfo = {
                    startTime: Date.now(),
                    expectedDurationMs: (buffer.duration / playbackRate) * 1000
                };

                source.onended = () => {
                    currentAudioSourceRef.current = null;

                    if (sessionId !== undefined && playbackSessionIdRef.current !== sessionId) {
                        resolve();
                        return;
                    }

                    const timeElapsed = Date.now() - timingInfo.startTime;
                    const remainingTime = timingInfo.expectedDurationMs - timeElapsed;

                    let safetyBuffer: number;
                    if (isIOS) {
                        const iosBuffer = Math.max(1500, Math.min(2000, timingInfo.expectedDurationMs * 0.1));
                        safetyBuffer = iosBuffer;
                        console.log(`[playAudioChunk] iOS device detected, using ${iosBuffer.toFixed(0)}ms buffer`);
                    } else {
                        safetyBuffer = 200;
                    }

                    const waitTime = Math.max(0, remainingTime) + safetyBuffer;
                    const dynamicCap = Math.max(30000, timingInfo.expectedDurationMs * 1.5);
                    const cappedWaitTime = Math.min(waitTime, dynamicCap);

                    setTimeout(() => {
                        if (shouldContinuePlayingRef.current && currentPlaybackIdRef.current === id) {
                            if (onComplete) {
                                onComplete();
                            }
                        }
                        resolve();
                    }, cappedWaitTime);
                };

                source.addEventListener('error', (event: Event) => {
                    const error = (event as any).error || event;
                    console.error('Audio source error:', error);
                    currentAudioSourceRef.current = null;
                    shouldContinuePlayingRef.current = false;
                    currentPlaybackIdRef.current = null;
                    setIsPlayingAudio(false);
                    setActiveAudioId(null);

                    const errorMsg = error?.message || 'Unknown audio error';
                    if (errorMsg.includes('NotAllowedError') || errorMsg.includes('NotSupportedError')) {
                        showToast('Audio playback not allowed. Please check device permissions.', 'error');
                    } else {
                        showToast('Error playing audio. Please try again.', 'error');
                    }
                    resolve();
                });

                if (
                    !shouldContinuePlayingRef.current ||
                    currentPlaybackIdRef.current !== id ||
                    (sessionId !== undefined && playbackSessionIdRef.current !== sessionId)
                ) {
                    resolve();
                    return;
                }

                currentAudioSourceRef.current = source;
                setIsPlayingAudio(true);
                setActiveAudioId(id);

                const ensureContextRunning = async () => {
                    let currentState = ctx.state as string;
                    if (currentState !== 'running') {
                        console.log(`[playAudioChunk] Context not running before start (${currentState}), attempting to resume...`);
                        await ctx.resume();
                        await new Promise(resolve => setTimeout(resolve, 50));
                        currentState = ctx.state as string;
                        if (currentState !== 'running') {
                            throw new Error(`AudioContext is ${currentState}, cannot start playback`);
                        }
                    }
                };

                ensureContextRunning()
                    .then(async () => {
                        await new Promise(resolve => setTimeout(resolve, 10));
                        timingInfo.startTime = Date.now();
                        source.start(0);
                        console.log('[playAudioChunk] Audio started successfully');
                    })
                    .catch((error: any) => {
                        console.error('Error starting audio:', error);
                        currentAudioSourceRef.current = null;
                        shouldContinuePlayingRef.current = false;
                        currentPlaybackIdRef.current = null;
                        setIsPlayingAudio(false);
                        setActiveAudioId(null);

                        const errorMsg = error?.message || 'Unknown error';
                        if (errorMsg.includes('suspended') || errorMsg.includes('NotAllowedError')) {
                            showToast('Audio requires user interaction. Please tap play again.', 'error');
                        } else {
                            showToast('Error starting audio playback. Please try again.', 'error');
                        }
                        resolve();
                    });
            });
        } catch (error) {
            console.error('Audio playback error:', error);
            showToast('Error playing audio', 'error');
            setIsPlayingAudio(false);
            setActiveAudioId(null);
        }
    };

    const playAudio = async (
        audioData: string | string[] | Response,
        id: string | number = 'main',
        format?: AudioFormat
    ) => {
        stopCurrentAudio();

        // Handle streaming audio (Response) - PRIMARY METHOD
        if (audioData instanceof Response) {
            try {
                const contentType = audioData.headers.get('Content-Type') || '';
                const sampleRateHeader = audioData.headers.get('X-Audio-Sample-Rate');
                const sampleRate = sampleRateHeader ? parseInt(sampleRateHeader, 10) : 44100;

                // Dynamically determine format from Content-Type (like test page)
                const audioFormat: AudioFormat = format || (
                    contentType.includes('audio/L16') ? 'pcm' :
                        contentType.includes('audio/wav') ? 'wav' :
                            contentType.includes('audio/mpeg') ? 'mp3' : 'wav'
                );

                console.log(`[AudioManager] Creating AudioStreamPlayer (format: ${audioFormat}, sampleRate: ${sampleRate}Hz)`);
                const player = new AudioStreamPlayer({
                    format: audioFormat,
                    sampleRate: sampleRate,
                    onLog: (msg) => console.log(`[AudioPlayer] ${msg}`),
                    onStatusChange: (status) => console.log(`[AudioPlayer] Status: ${status}`)
                });
                audioPlayerRef.current = player;

                setIsPlayingAudio(true);
                setActiveAudioId(id);
                shouldContinuePlayingRef.current = true;
                currentPlaybackIdRef.current = id;

                player.playFromResponse(audioData).then(() => {
                    console.log('[AudioManager] Streaming playback completed');
                    if (audioPlayerRef.current === player) {
                        audioPlayerRef.current = null;
                    }
                    setIsPlayingAudio(false);
                    setActiveAudioId(null);
                    currentPlaybackIdRef.current = null;
                }).catch((error) => {
                    console.error('Error during streaming playback:', error);
                    if (audioPlayerRef.current === player) {
                        audioPlayerRef.current = null;
                    }
                    showToast('Error playing audio', 'error');
                    setIsPlayingAudio(false);
                    setActiveAudioId(null);
                    currentPlaybackIdRef.current = null;
                });
            } catch (error) {
                console.error('Error initializing streaming audio:', error);
                audioPlayerRef.current = null;
                showToast('Error playing audio', 'error');
                setIsPlayingAudio(false);
                setActiveAudioId(null);
                currentPlaybackIdRef.current = null;
            }
            return;
        }

        // Handle base64 audio (for backward compatibility only)
        const chunks = Array.isArray(audioData) ? audioData : [audioData as string];

        if (chunks.length === 0 || chunks.some(chunk => !chunk || chunk.trim() === '')) {
            console.error('Invalid audio data:', chunks);
            showToast('Invalid audio data', 'error');
            return;
        }

        const sessionId = ++playbackSessionIdRef.current;
        shouldContinuePlayingRef.current = true;
        currentPlaybackIdRef.current = id;
        audioChunksRef.current = chunks;
        currentChunkIndexRef.current = 0;

        const playNextChunk = async (index: number, currentSessionId: number) => {
            if (playbackSessionIdRef.current !== currentSessionId) {
                return;
            }

            if (!shouldContinuePlayingRef.current || currentPlaybackIdRef.current !== id) {
                if (playbackSessionIdRef.current === currentSessionId) {
                    setIsPlayingAudio(false);
                    setActiveAudioId(null);
                    audioChunksRef.current = [];
                    currentChunkIndexRef.current = 0;
                }
                return;
            }

            if (index >= chunks.length) {
                if (playbackSessionIdRef.current === currentSessionId) {
                    shouldContinuePlayingRef.current = false;
                    currentPlaybackIdRef.current = null;
                    setIsPlayingAudio(false);
                    setActiveAudioId(null);
                    audioChunksRef.current = [];
                    currentChunkIndexRef.current = 0;
                }
                return;
            }

            if (activeAudioId !== null && activeAudioId !== id) {
                shouldContinuePlayingRef.current = false;
                currentPlaybackIdRef.current = null;
                return;
            }

            try {
                await playAudioChunk(chunks[index], id, () => {
                    if (playbackSessionIdRef.current !== currentSessionId) {
                        return;
                    }

                    if (
                        shouldContinuePlayingRef.current &&
                        currentPlaybackIdRef.current === id &&
                        playbackSessionIdRef.current === currentSessionId &&
                        index + 1 < chunks.length
                    ) {
                        currentChunkIndexRef.current = index + 1;
                        playNextChunk(index + 1, currentSessionId);
                    } else {
                        if (playbackSessionIdRef.current === currentSessionId) {
                            shouldContinuePlayingRef.current = false;
                            currentPlaybackIdRef.current = null;
                            setIsPlayingAudio(false);
                            setActiveAudioId(null);
                            audioChunksRef.current = [];
                            currentChunkIndexRef.current = 0;
                        }
                    }
                }, currentSessionId);
            } catch (error) {
                console.error('Error playing chunk:', error);
                if (playbackSessionIdRef.current === currentSessionId) {
                    shouldContinuePlayingRef.current = false;
                    currentPlaybackIdRef.current = null;
                    setIsPlayingAudio(false);
                    setActiveAudioId(null);
                    audioChunksRef.current = [];
                    currentChunkIndexRef.current = 0;
                }
            }
        };

        playNextChunk(0, sessionId);
    };

    const stopCurrentAudio = () => {
        playbackSessionIdRef.current += 1;
        shouldContinuePlayingRef.current = false;
        currentPlaybackIdRef.current = null;

        if (audioPlayerRef.current) {
            try {
                audioPlayerRef.current.stop();
            } catch (e) {
                console.error('Error stopping audio player:', e);
            }
            audioPlayerRef.current = null;
        }

        if (currentAudioSourceRef.current) {
            try {
                currentAudioSourceRef.current.onended = null;
                currentAudioSourceRef.current.stop();
            } catch (e) { }
            currentAudioSourceRef.current = null;
        }

        setIsPlayingAudio(false);
        setActiveAudioId(null);
        audioChunksRef.current = [];
        currentChunkIndexRef.current = 0;
    };

    const setPlaybackSpeed = (rate: number) => {
        setPlaybackRateState(rate);
        if (currentAudioSourceRef.current && currentAudioSourceRef.current.playbackRate) {
            currentAudioSourceRef.current.playbackRate.value = rate;
        }
    };

    const handleTogglePlayback = async (text: string, id: string = 'main', entryId?: string) => {
        console.log('[AudioManager] handleTogglePlayback called');

        ensureAudioContext();

        if (isPlayingAudio && activeAudioId === id) {
            console.log('[AudioManager] Path: Stop playing audio');
            stopCurrentAudio();
            return;
        }

        if (currentAudioBase64 && (activeAudioId !== id || !isPlayingAudio)) {
            console.log('[AudioManager] Path: Play existing currentAudioBase64');
            const audioData = typeof currentAudioBase64 === 'string'
                ? currentAudioBase64
                : Array.isArray(currentAudioBase64)
                    ? currentAudioBase64
                    : [currentAudioBase64];
            playAudio(audioData, id);
        } else {
            console.log('[AudioManager] Path: Generate new audio for reflection');
            setIsGeneratingVoice(true);
            setGeneratingAudioId(id);
            try {
                console.log('[AudioManager] Generating streaming audio for reflection...');
                // Pass entryId for journal entries, use id for other cases
                const audioStream = await generateSpeechStream(text, entryId);

                if (audioStream) {
                    console.log('[AudioManager] Audio stream received, starting progressive playback...');
                    setIsGeneratingVoice(false);
                    setGeneratingAudioId(null);
                    playAudio(audioStream, id);
                    console.log('[AudioManager] Playback initiated (will start in 2-3s as stream buffers)');
                } else {
                    const audioResult = await generateSpeech(text, { chunked: text.length > 1500 });
                    if (audioResult) {
                        const audioData = Array.isArray(audioResult) ? audioResult : [audioResult];
                        setCurrentAudioBase64(audioData);
                        playAudio(audioData, id);
                    } else {
                        showToast('Could not generate audio. Please try again.', 'error');
                    }
                }
            } catch (error) {
                console.error('TTS generation error:', error);
                showToast('Error generating speech. Please try again.', 'error');
            } finally {
                setIsGeneratingVoice(false);
                setGeneratingAudioId(null);
            }
        }
    };

    const handleHistoryAudioPlayback = async (text: string, id: string) => {
        ensureAudioContext();

        if (isPlayingAudio && activeAudioId === id) {
            stopCurrentAudio();
            return;
        }

        setGeneratingAudioId(id);
        setIsGeneratingVoice(true);
        try {
            const entryId = id.replace('history-', '');
            if (entryId && userId && !isDemoMode) {
                const response = await fetch(`/api/history/audio?entryId=${encodeURIComponent(entryId)}&streaming=true`);
                if (response.ok && response.body) {
                    console.log('[AudioManager] Got audio stream (S3 or database), starting playback...');
                    setIsGeneratingVoice(false);
                    setGeneratingAudioId(null);
                    playAudio(response, id);
                    return;
                }
            }

            const audioStream = await generateSpeechStream(text, entryId);
            if (audioStream) {
                setIsGeneratingVoice(false);
                setGeneratingAudioId(null);
                playAudio(audioStream, id);
            } else {
                const audioResult = await generateSpeech(text, { chunked: text.length > 1500 });
                if (audioResult) {
                    const audioData = Array.isArray(audioResult) ? audioResult : [audioResult];
                    playAudio(audioData, id);
                } else {
                    showToast('Could not generate audio. Please try again.', 'error');
                }
            }
        } catch (error) {
            console.error('TTS generation error:', error);
            showToast('Error generating speech. Please try again.', 'error');
        } finally {
            setIsGeneratingVoice(false);
            setGeneratingAudioId(null);
        }
    };

    const handleToggleChatPlayback = async (text: string, index: number) => {
        ensureAudioContext();

        const id = `chat-${index}`;

        if (isPlayingAudio && activeAudioId === id) {
            stopCurrentAudio();
        } else {
            // Implementation for chat audio playback
            setGeneratingAudioId(id);
            setIsGeneratingVoice(true);
            try {
                const cached = await audioCache.get(text);
                if (cached) {
                    const audioData = typeof cached === 'string' ? cached : [cached];
                    playAudio(audioData, id);
                } else {
                    const audioResult = await generateSpeech(text, { chunked: text.length > 1500 });
                    if (audioResult) {
                        const audioData = Array.isArray(audioResult) ? audioResult : [audioResult];
                        playAudio(audioData, id);
                    } else {
                        showToast('Could not generate audio. Please try again.', 'error');
                    }
                }
            } catch (error) {
                console.error('TTS generation error:', error);
                showToast('Error generating speech. Please try again.', 'error');
            } finally {
                setIsGeneratingVoice(false);
                setGeneratingAudioId(null);
            }
        }
    };

    const ensureAudioContext = () => {
        if (!audioContextRef.current) {
            try {
                audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
                console.log('[AudioManager] AudioContext created on user interaction');
            } catch (error) {
                console.error('[AudioManager] Failed to create AudioContext:', error);
                showToast('Audio not supported on this device', 'error');
            }
        }
        return audioContextRef.current;
    };

    // Audio sync effect
    useEffect(() => {
        if (!userId || isDemoMode) return;

        const runAudioSync = async () => {
            if (audioSyncRef.current || !shouldRunSync()) return;

            console.log('[AudioManager] Starting background audio sync...');
            audioSyncRef.current = true;
            setIsAudioSyncing(true);

            try {
                const result = await withRetry(
                    'sync-audio',
                    () => syncAudioToDatabase((progress) => {
                        setAudioSyncProgress(progress);
                        if (progress.isComplete) {
                            console.log(`[AudioManager] Audio sync complete: ${progress.saved} file(s) synced`);
                        }
                    }),
                    3,
                    3000
                );

                if (result.success && result.saved > 0) {
                    console.log(`[AudioManager] ${result.saved} audio file(s) synced to cloud`);
                }
            } catch (error) {
                console.error('[AudioManager] Audio sync error:', error);
            } finally {
                setIsAudioSyncing(false);
                setAudioSyncProgress(null);
                audioSyncRef.current = false;
            }
        };

        const initialSyncTimeout = setTimeout(() => runAudioSync(), 5000);
        const syncInterval = setInterval(() => runAudioSync(), 300000); // 5 minutes

        return () => {
            clearTimeout(initialSyncTimeout);
            clearInterval(syncInterval);
        };
    }, [userId, isDemoMode]);

    // Cleanup
    useEffect(() => {
        return () => {
            stopCurrentAudio();
            if (audioContextRef.current) {
                audioContextRef.current.close().catch(console.error);
                audioContextRef.current = null;
            }
        };
    }, []);

    const renderProps: AudioManagerRenderProps = {
        isPlayingAudio,
        playbackRate,
        activeAudioId,
        generatingAudioId,
        isGeneratingVoice,
        audioSyncProgress,
        isAudioSyncing,
        playAudio,
        stopCurrentAudio,
        setPlaybackSpeed,
        handleTogglePlayback: (text: string, id?: string, entryId?: string) => handleTogglePlayback(text, id, entryId),
        handleHistoryAudioPlayback,
        handleToggleChatPlayback,
    };

    return <>{children(renderProps)}</>;
};
