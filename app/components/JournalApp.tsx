'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Reflection, AppStatus, ViewMode, HistoryEntry, Mood, ChatMessage, ReflectionProgress, TokenUsage, CumulativeTokenUsage } from '../types';
import { getJournalReflection, getJournalReflectionStream } from '../services/journalAIService';
import { StreamingCallback } from '../services/providers/llm/interface';
import { showToast, ToastContainer } from '../utils/toast';
import { generateUUID } from '../utils/uuid';
import { withRetry } from '../utils/retry';
import { generateAudioS3Key } from '../utils/audioS3Key';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { useSession, signOut } from 'next-auth/react';
import { HistoryManager } from './HistoryManager';
import { ChatManager } from './ChatManager';
import { AudioManager } from './AudioManager';
import { JournalInterface } from './JournalInterface';

// Generate user-scoped keys to prevent data leakage between users
const getHistoryKey = (userId: string | null, isDemo: boolean) => {
  if (isDemo) return 'serenity_journal_history_demo';
  if (userId) return `serenity_journal_history_${userId}`;
  return 'serenity_journal_history'; // Fallback for old data
};

const getAutoPlayKey = (userId: string | null, isDemo: boolean) => {
  if (isDemo) return 'serenity_journal_autoplay_demo';
  if (userId) return `serenity_journal_autoplay_${userId}`;
  return 'serenity_journal_autoplay'; // Fallback for old data
};

// Legacy keys for migration
const LEGACY_HISTORY_KEY = 'serenity_journal_history';
const LEGACY_AUTO_PLAY_KEY = 'serenity_journal_autoplay';

const MOODS: { label: string; value: Mood }[] = [
  { label: 'Calm', value: 'calm' },
  { label: 'Joyful', value: 'joyful' },
  { label: 'Reflective', value: 'reflective' },
  { label: 'Heavy', value: 'heavy' },
  { label: 'Anxious', value: 'anxious' },
  { label: 'Tired', value: 'tired' },
];

const JournalApp: React.FC = () => {
  const { data: session, status: authStatus } = useSession();
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.JOURNAL);

  // Journal state
  const [sessionKey, setSessionKey] = useState(0);
  const [showStartNewDialog, setShowStartNewDialog] = useState(false);
  const [entry, setEntry] = useState<string>('');
  const [selectedMood, setSelectedMood] = useState<Mood>('none');
  const [reflection, setReflection] = useState<Reflection | null>(null);
  const [streamingReflection, setStreamingReflection] = useState<string>(''); // For streaming text display
  const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
  const [error, setError] = useState<string | null>(null);
  const [currentHistoryId, setCurrentHistoryId] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [autoPlayEnabled, setAutoPlayEnabled] = useState<boolean>(false);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);

  // Chat state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isChatting, setIsChatting] = useState(false);
  const [isSendingChat, setIsSendingChat] = useState(false);
  const [contextRevalidated, setContextRevalidated] = useState(false);

  // UI refs
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const entryRef = useRef(entry);

  // Progress and usage tracking
  const [reflectionProgress, setReflectionProgress] = useState<ReflectionProgress | null>(null);
  const [currentTokenUsage, setCurrentTokenUsage] = useState<TokenUsage | null>(null);
  const [cumulativeTokenUsage, setCumulativeTokenUsage] = useState<CumulativeTokenUsage>({
    totalPromptTokens: 0,
    totalCachedTokens: 0,
    totalCompletionTokens: 0,
    totalTokens: 0,
    requestCount: 0,
  });

  // History service refs (for migration logic)
  const isHydratedRef = useRef(false);
  const prevUserIdRef = useRef<string | null>(null);

  // Get current user ID
  const userId = session?.user?.id || null;

  // Check for demo mode - should not be active if user is authenticated
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const demoCookie = document.cookie
        .split('; ')
        .find(row => row.startsWith('demo-mode='));
      const hasDemoCookie = demoCookie?.split('=')[1] === 'true';

      // If user is authenticated, they shouldn't be in demo mode
      if (session?.user && hasDemoCookie) {
        // Clear demo cookie if user is logged in
        document.cookie = 'demo-mode=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
        setIsDemoMode(false);
      } else {
        setIsDemoMode(hasDemoCookie && !session?.user);
      }
    }
  }, [session?.user]);

  // Clear demo cookie when user logs in
  useEffect(() => {
    if (typeof window !== 'undefined' && session?.user) {
      // Clear demo cookie if it exists
      const demoCookie = document.cookie
        .split('; ')
        .find(row => row.startsWith('demo-mode='));
      if (demoCookie) {
        document.cookie = 'demo-mode=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
      }
    }
  }, [session?.user]);

  // Journal entry handling
  const handleEntryChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setEntry(e.target.value);
  };

  useEffect(() => {
    entryRef.current = entry;
    // Auto-resize textarea
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [entry]);

  // Reflection generation
  const handleGetReflection = useCallback(async (
    audioProps: any // AudioManager render props
  ) => {
    if (!entry.trim()) return;

    setStatus(AppStatus.LOADING);
    setError(null);
    setIsChatting(false);
    setChatMessages([]);
    setReflectionProgress(null); // Clear previous progress
    setStreamingReflection(''); // Clear streaming text
    audioProps.stopCurrentAudio();

    try {
      // Streaming callback to update UI in real-time
      const streamingCallback: StreamingCallback = (chunk) => {
        console.log('[JournalApp] Received streaming chunk:', chunk);
        setStreamingReflection(prev => prev + chunk.text);

        if (chunk.isComplete) {
          console.log('[JournalApp] Streaming completed');
          // Streaming is complete, will finalize below
        }
      };

      // Wrap with retry logic for iOS background suspension
      const { summary, topic, mood: detectedMood, entities, highlights, tokenUsage } = await withRetry(
        'get-reflection-stream',
        () => getJournalReflectionStream(
          entry,
          selectedMood,
          history,
          streamingCallback,
          (progress) => {
            console.log('[JournalApp] Progress update:', progress.stage, progress.message);
            setReflectionProgress(progress);
          }
        ),
        3,
        2000
      );

      // Update token usage tracking
      if (tokenUsage) {
        setCurrentTokenUsage(tokenUsage);
        setCumulativeTokenUsage(prev => ({
          totalPromptTokens: prev.totalPromptTokens + tokenUsage.promptTokens,
          totalCachedTokens: prev.totalCachedTokens + (tokenUsage.cachedTokens || 0),
          totalCompletionTokens: prev.totalCompletionTokens + tokenUsage.completionTokens,
          totalTokens: prev.totalTokens + tokenUsage.totalTokens,
          requestCount: prev.requestCount + 1,
        }));
      }

      console.log(`[JournalApp] Received streaming reflection with topic: "${topic}", mood: "${detectedMood}", entities:`, entities, 'highlights:', highlights);

      // Create the final reflection object with the complete streamed text
      const finalReflectionContent = streamingReflection;
      const newReflection = {
        content: finalReflectionContent,
        summary,
        timestamp: new Date(),
        topic,
        highlights // Include highlights in reflection state
      };

      const newId = generateUUID();
      setCurrentHistoryId(newId);
      setReflection(newReflection);
      setStatus(AppStatus.SUCCESS);
      setReflectionProgress(null); // Clear progress on success

      // Generate S3 key for audio storage (if S3 is configured and user is authenticated)
      let audioS3Key: string | undefined;
      if (userId && !isDemoMode) {
        try {
          audioS3Key = generateAudioS3Key(finalReflectionContent, userId);
          console.log(`[JournalApp] Generated S3 key for entry: ${audioS3Key}`);
        } catch (error) {
          console.warn('[JournalApp] Failed to generate S3 key:', error);
          // Continue without S3 key - will use background migration
        }
      }

      const newHistoryEntry: HistoryEntry = {
        id: newId,
        text: entry,
        summary: summary,
        reflection: finalReflectionContent,
        mood: detectedMood || selectedMood, // Use AI-detected mood, fallback to selected
        topic: topic,
        timestamp: new Date().toISOString(),
        chatHistory: [],
        audioS3Key: audioS3Key, // Include S3 key for audio storage
        entities: entities, // Save extracted entities
        highlights: highlights // Save AI-detected highlights
      };
      console.log(`[JournalApp] Created history entry with topic: "${topic}", entities:`, entities, 'highlights:', highlights, 'audioS3Key:', audioS3Key);

      setHistory(prev => [newHistoryEntry, ...prev]);

      // Auto-generate audio if auto-play is enabled
      if (autoPlayEnabled) {
        console.log('[JournalApp] Auto-generating audio because auto-play is enabled');
        audioProps.handleTogglePlayback(finalReflectionContent, 'main', newId);
      }

      setTimeout(() => {
        window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
      }, 100);
    } catch (err: any) {
      console.error(err);

      // Parse API error to show user-friendly message
      let errorMessage = "I'm sorry, I couldn't reflect on that right now. Please try again when you're ready.";

      if (err?.error?.code === 429 || err?.status === 429 || err?.error?.status === 'RESOURCE_EXHAUSTED') {
        // Rate limit / Quota exceeded
        const retryDelay = err?.error?.details?.find((d: any) => d?.['@type']?.includes('RetryInfo'))?.retryDelay ||
          err?.error?.message?.match(/retry in ([\d.]+)s/)?.[1];

        if (retryDelay) {
          const seconds = Math.ceil(parseFloat(retryDelay));
          errorMessage = `Rate limit exceeded. Please wait ${seconds} seconds before trying again.`;
        } else {
          errorMessage = 'Rate limit exceeded. Please wait a moment and try again.';
        }
        showToast(errorMessage, 'error');
      } else if (err?.error?.code === 401 || err?.status === 401) {
        // Authentication error
        errorMessage = 'API key is invalid. Please check your configuration.';
        showToast(errorMessage, 'error');
      } else if (err?.error?.code === 403 || err?.status === 403) {
        // Permission error
        errorMessage = 'Access denied. Please check your API key permissions.';
        showToast(errorMessage, 'error');
      } else if (err?.message) {
        // Use error message if available
        errorMessage = err.message;
        showToast(errorMessage, 'error');
      } else {
        // Generic error
        showToast(errorMessage, 'error');
      }

      setError(errorMessage);
      setStatus(AppStatus.ERROR);
      setReflectionProgress(null); // Clear progress on error
      setStreamingReflection(''); // Clear streaming text on error
    }
  }, [entry, selectedMood, history, autoPlayEnabled, streamingReflection]);

  // Action handlers
  const handleStartFresh = () => {
    setShowStartNewDialog(false);
    setSessionKey(prev => prev + 1);
    setEntry('');
    setReflection(null);
    setChatMessages([]);
    setIsChatting(false);
    setStatus(AppStatus.IDLE);
    setError(null);
    setCurrentHistoryId(null);
    setCurrentTokenUsage(null);
    setCumulativeTokenUsage({
      totalPromptTokens: 0,
      totalCachedTokens: 0,
      totalCompletionTokens: 0,
      totalTokens: 0,
      requestCount: 0,
    });

    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    showToast('Started a new session', 'success');
  };

  const handleToggleAutoPlay = () => {
    const newValue = !autoPlayEnabled;
    setAutoPlayEnabled(newValue);
    showToast(`Auto-play ${newValue ? 'enabled' : 'disabled'}`, 'success');
  };

  const handleExitDemo = () => {
    document.cookie = 'demo-mode=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
    window.location.href = '/login';
  };

  // Save history to localStorage (HistoryManager handles database)
  useEffect(() => {
    if (typeof window !== 'undefined' && isHydratedRef.current) {
      // Don't save if we're in the middle of a user switch
      const isUserMismatch = prevUserIdRef.current !== userId;
      if (isUserMismatch) {
        console.log('Skipping save - user mismatch:', { prev: prevUserIdRef.current, current: userId });
        return;
      }

      if (isDemoMode) {
        // Demo mode: use localStorage
        const historyWithoutAudio = history.map(({ audioBase64, ...entry }) => entry);
        localStorage.setItem(getHistoryKey(userId, isDemoMode), JSON.stringify(historyWithoutAudio));
        localStorage.setItem(getAutoPlayKey(userId, isDemoMode), autoPlayEnabled.toString());
        console.log(`Saved ${history.length} entries to localStorage (demo mode)`);
      }
    } else if (typeof window !== 'undefined' && !isHydratedRef.current) {
      console.log('Skipping save - not yet hydrated');
    }
  }, [history, autoPlayEnabled, isDemoMode, userId]);

  const isButtonDisabled = !entry.trim() || status === AppStatus.LOADING;
  const wordCount = entry.trim() ? entry.trim().split(/\s+/).length : 0;

  return (
    <HistoryManager
      userId={userId}
      isDemoMode={isDemoMode}
      history={history}
      autoPlayEnabled={autoPlayEnabled}
      onHistoryChange={setHistory}
      onAutoPlayChange={setAutoPlayEnabled}
      onPreferencesLoaded={setPreferencesLoaded}
    >
      {(historyProps) => (
        <AudioManager
          userId={userId}
          isDemoMode={isDemoMode}
          autoPlayEnabled={autoPlayEnabled}
        >
          {(audioProps) => (
            <ChatManager
              entry={entry}
              reflection={reflection ? { content: reflection.content, topic: reflection.topic || '' } : null}
              history={history}
              selectedMood={selectedMood}
              autoPlayEnabled={autoPlayEnabled}
              onMessagesChange={setChatMessages}
              onSendingChange={setIsSendingChat}
              onContextRevalidatedChange={setContextRevalidated}
            >
              {(chatProps) => (
                <JournalInterface
                  // App state
                  sessionKey={sessionKey}
                  viewMode={viewMode}
                  onViewModeChange={setViewMode}
                  isDemoMode={isDemoMode}
                  session={session}
                  authStatus={authStatus}

                  // Journal state
                  entry={entry}
                  onEntryChange={handleEntryChange}
                  selectedMood={selectedMood}
                  onSelectedMoodChange={setSelectedMood}
                  reflection={reflection}
                  streamingReflection={streamingReflection}
                  status={status}
                  error={error}
                  reflectionProgress={reflectionProgress}
                  autoPlayEnabled={autoPlayEnabled}
                  wordCount={wordCount}

                  // Chat state
                  chatMessages={chatMessages}
                  isChatting={isChatting}
                  isSendingChat={isSendingChat}
                  contextRevalidated={contextRevalidated}

                  // Audio state (from AudioManager)
                  isPlayingAudio={audioProps.isPlayingAudio}
                  isGeneratingVoice={audioProps.isGeneratingVoice}
                  isAudioSyncing={audioProps.isAudioSyncing}
                  audioSyncProgress={audioProps.audioSyncProgress}
                  activeAudioId={audioProps.activeAudioId}
                  generatingAudioId={audioProps.generatingAudioId}

                  // History state
                  history={history}
                  currentHistoryId={currentHistoryId}

                  // Actions
                  onGetReflection={() => handleGetReflection(audioProps)}
                  onStartFresh={handleStartFresh}
                  onToggleAutoPlay={handleToggleAutoPlay}
                  onExitDemo={handleExitDemo}

                  // Audio actions (from AudioManager)
                  onTogglePlayback={(text) => audioProps.handleTogglePlayback(text)}
                  onHistoryAudioPlayback={(text, id) => audioProps.handleHistoryAudioPlayback(text, id)}
                  onToggleChatPlayback={(text, index) => audioProps.handleToggleChatPlayback(text, index)}

                  // Chat actions (from ChatManager)
                  onSendMessage={chatProps.onSendMessage}
                  onClearChat={chatProps.onClearChat}
                  onInvalidateChatSession={chatProps.onInvalidateChatSession}
                  onStartNewChat={chatProps.onClearChat} // Map to clear chat for now

                  // History actions (from HistoryManager)
                  onDeleteEntry={historyProps.onDeleteEntry}
                  onClearAllHistory={historyProps.onClearAllHistory}
                />
              )}
            </ChatManager>
          )}
        </AudioManager>
      )}
    </HistoryManager>
  );
};

export default JournalApp;
