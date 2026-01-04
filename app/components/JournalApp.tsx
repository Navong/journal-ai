'use client';

// Type declaration for Wake Lock API (not yet in TypeScript lib)
interface WakeLockSentinel extends EventTarget {
  released: boolean;
  type: 'screen';
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
  removeEventListener(type: 'release', listener: () => void): void;
}

interface Navigator {
  wakeLock?: {
    request(type: 'screen'): Promise<WakeLockSentinel>;
  };
}

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Reflection, AppStatus, ViewMode, HistoryEntry, Mood, ChatMessage, AudioPlaybackState, ReflectionProgress, TokenUsage, CumulativeTokenUsage } from '../types';
import { getJournalReflection, startJournalChat, generateSpeechStream } from '../services/journalAIService';
import { generateSpeech } from '../utils/audioGeneration';
import { ReflectionCard } from './ReflectionCard';
import { HistoryView } from './HistoryView';
import { ChatInterface } from './ChatInterface';
import { ChatSession } from '../services/providers/llm/interface';
import { audioCache } from '../utils/audioCache';
import { showToast, ToastContainer } from '../utils/toast';
import { generateUUID } from '../utils/uuid';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { useSession, signOut } from 'next-auth/react';
import { historyService } from '../services/historyService';
import { optimizeAudio } from '../utils/audioOptimization';
import { syncAudioToDatabase, getSyncStats, shouldRunSync, getSyncState, AudioSyncProgress, SYNC_INTERVAL } from '../utils/audioSync';
import { createProgressiveAudioPlayer } from '../utils/audioStreaming';

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

function decodeBase64(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

const JournalApp: React.FC = () => {
  const { data: session, status: authStatus } = useSession();
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>(ViewMode.JOURNAL);

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
  }, [session?.user]); // Re-check when session changes
  const [sessionKey, setSessionKey] = useState(0);
  const [showStartNewDialog, setShowStartNewDialog] = useState(false);
  const [entry, setEntry] = useState<string>('');
  const [selectedMood, setSelectedMood] = useState<Mood>('none');
  const [reflection, setReflection] = useState<Reflection | null>(null);
  const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
  const [error, setError] = useState<string | null>(null);
  const [currentHistoryId, setCurrentHistoryId] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const isHydratedRef = useRef(false);
  const [isMounted, setIsMounted] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const currentAudioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [currentAudioBase64, setCurrentAudioBase64] = useState<string | string[] | null>(null);
  const [isGeneratingVoice, setIsGeneratingVoice] = useState(false);
  const [autoPlayEnabled, setAutoPlayEnabled] = useState<boolean>(false); // Default to false until preferences load
  const [preferencesLoaded, setPreferencesLoaded] = useState(false); // Track if preferences have been loaded

  const [activeAudioId, setActiveAudioId] = useState<string | number | null>(null);
  const [generatingAudioId, setGeneratingAudioId] = useState<string | number | null>(null);
  const audioChunksRef = useRef<string[]>([]);

  // Audio sync state
  const [audioSyncProgress, setAudioSyncProgress] = useState<AudioSyncProgress | null>(null);
  const [isAudioSyncing, setIsAudioSyncing] = useState(false);
  const audioSyncRef = useRef(false); // Prevent multiple syncs
  const currentChunkIndexRef = useRef<number>(0);
  const shouldContinuePlayingRef = useRef<boolean>(false);
  const currentPlaybackIdRef = useRef<string | number | null>(null);
  const playbackSessionIdRef = useRef<number>(0);

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isChatting, setIsChatting] = useState(false);
  const chatSessionRef = useRef<ChatSession | null>(null);
  const [isSendingChat, setIsSendingChat] = useState(false);
  const [contextRevalidated, setContextRevalidated] = useState(false);

  // Reflection generation progress tracking
  const [reflectionProgress, setReflectionProgress] = useState<ReflectionProgress | null>(null);

  // Token usage tracking for cost transparency
  const [currentTokenUsage, setCurrentTokenUsage] = useState<TokenUsage | null>(null);
  const [cumulativeTokenUsage, setCumulativeTokenUsage] = useState<CumulativeTokenUsage>({
    totalPromptTokens: 0,
    totalCachedTokens: 0,
    totalCompletionTokens: 0,
    totalTokens: 0,
    requestCount: 0,
  });

  const entryRef = useRef(entry);

  // Get current user ID or demo identifier
  const userId = session?.user?.id || null;
  const currentHistoryKey = getHistoryKey(userId, isDemoMode);
  const currentAutoPlayKey = getAutoPlayKey(userId, isDemoMode);
  const prevUserIdRef = useRef<string | null>(null);
  const prevDemoModeRef = useRef<boolean>(false);

  // Wake Lock and background operation management for iOS/mobile
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const ongoingOperationsRef = useRef<Set<string>>(new Set()); // Track ongoing operations
  const pendingOperationsRef = useRef<Map<string, () => Promise<any>>>(new Map()); // Operations to resume

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

      // Clear demo localStorage data when switching to authenticated
      if (isHydratedRef.current) {
        const demoHistory = localStorage.getItem('serenity_journal_history_demo');
        if (demoHistory) {
          localStorage.removeItem('serenity_journal_history_demo');
          localStorage.removeItem('serenity_journal_autoplay_demo');
        }
      }
    }
  }, [session?.user]); // Run when user logs in

  // Load history and preferences on mount or when user changes
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const currentUserId = userId;
      const currentDemoMode = isDemoMode;
      const previousUserId = prevUserIdRef.current;
      const previousDemoMode = prevDemoModeRef.current;

      console.log('[JournalApp] Load effect triggered:', {
        currentUserId,
        currentDemoMode,
        previousUserId,
        previousDemoMode,
        isHydrated: isHydratedRef.current,
        sessionStatus: authStatus,
        sessionAvailable: !!session,
        sessionUser: !!session?.user,
        sessionEmail: session?.user?.email,
        sessionId: session?.user?.id,
      });

      const isInitialHydration = !isHydratedRef.current;
      const isUserChange = previousUserId !== currentUserId;
      const isModeChange = previousDemoMode !== currentDemoMode;

      // Run on initial hydration or when user/demo mode changes
      // Also run if we have a session but haven't loaded data yet (session loaded asynchronously)
      // Wait for session to finish loading (authStatus !== 'loading')
      const shouldLoad = (isInitialHydration || isUserChange || isModeChange ||
        (authStatus === 'authenticated' && session?.user && !isHydratedRef.current && !isDemoMode)) &&
        authStatus !== 'loading';

      if (shouldLoad) {
        console.log('[JournalApp] Loading data - reason:', {
          isInitialHydration,
          isUserChange,
          isModeChange,
          sessionAvailable: !!session?.user,
        });

        // Clear history and reset state immediately when switching users to prevent showing wrong data
        if (!isInitialHydration && (isUserChange || isModeChange)) {
          setHistory([]);
          setAutoPlayEnabled(true); // Reset to default
          setReflection(null);
          setEntry('');
          setCurrentHistoryId(null);
        }

        const loadData = async () => {
          // Wait a bit if session is not ready yet (session loads asynchronously)
          if (!currentDemoMode && !currentUserId && session?.user) {
            console.log('[JournalApp] Waiting for userId from session...');
            // Give NextAuth a moment to update the session
            await new Promise(resolve => setTimeout(resolve, 100));
            // Re-check after waiting
            if (!userId && session?.user?.id) {
              console.log('[JournalApp] Session user.id now available:', session.user.id);
              // Don't proceed - let the effect re-run with the new userId
              return;
            }
          }

          // Double-check user hasn't changed during async operation
          if (prevUserIdRef.current !== currentUserId && !isInitialHydration) {
            console.log('[JournalApp] User changed during wait, aborting load');
            return; // User changed again, abort this load
          }

          if (isDemoMode) {
            // Demo mode: use localStorage
            const savedHistory = localStorage.getItem(currentHistoryKey);
            if (savedHistory) {
              try {
                const parsed = JSON.parse(savedHistory);
                const cleanedHistory = parsed.map((entry: any) => {
                  const { audioBase64, ...rest } = entry;
                  return rest;
                });
                setHistory(cleanedHistory);
                console.log(`[JournalApp] ✅ Loaded ${cleanedHistory.length} entries from localStorage (demo)`);
              } catch (e) {
                console.error('Error parsing demo history:', e);
                setHistory([]);
              }
            } else {
              setHistory([]);
            }

            const savedAutoPlay = localStorage.getItem(currentAutoPlayKey);
            if (savedAutoPlay !== null) {
              setAutoPlayEnabled(savedAutoPlay === 'true');
            } else {
              setAutoPlayEnabled(false); // Default to false for new demo users
            }
            setPreferencesLoaded(true); // Mark preferences as loaded
          } else if (currentUserId) {
            // Authenticated: use Supabase
            try {
              console.log(`[JournalApp] Loading data for authenticated user: ${currentUserId}`);

              // Double-check user hasn't changed before making API call
              if (prevUserIdRef.current !== currentUserId && !isInitialHydration) {
                console.log('[JournalApp] User changed before API call, aborting load');
                return; // User changed, abort
              }

              console.log('[JournalApp] Fetching history and preferences...');
              // Only fetch first page on initial load to avoid loading all history
              const [historyResult, preferences] = await Promise.all([
                historyService.fetchHistory({ limit: 5, offset: 0 }),
                historyService.getPreferences(),
              ]);

              // Handle both old format (array) and new format (object with entries)
              const loadedHistory = Array.isArray(historyResult)
                ? historyResult
                : historyResult.entries || [];

              console.log(`[JournalApp] Received ${loadedHistory.length} entries and preferences:`, preferences);

              // Final check before setting state
              if (prevUserIdRef.current !== currentUserId && !isInitialHydration) {
                console.log('[JournalApp] User changed during API call, aborting state update');
                return; // User changed during API call, don't set stale data
              }

              console.log(`[JournalApp] ✅ Setting history with ${loadedHistory.length} entries`);
              setHistory(loadedHistory);

              if (preferences) {
                setAutoPlayEnabled(preferences.auto_play_enabled);
                console.log(`[JournalApp] ✅ Set autoPlayEnabled to ${preferences.auto_play_enabled}`);
              } else {
                setAutoPlayEnabled(false); // Default to false if no preferences found
              }
              setPreferencesLoaded(true); // Mark preferences as loaded

              // Migrate localStorage data to Supabase if exists
              const legacyHistory = localStorage.getItem(LEGACY_HISTORY_KEY);
              const legacyUserHistory = localStorage.getItem(`serenity_journal_history_${currentUserId}`);
              const historyToMigrate = legacyUserHistory || legacyHistory;

              if (historyToMigrate && loadedHistory.length === 0) {
                try {
                  const parsed = JSON.parse(historyToMigrate);
                  const cleanedHistory = parsed.map((entry: any) => {
                    const { audioBase64, ...rest } = entry;
                    return rest;
                  });

                  if (cleanedHistory.length > 0) {
                    console.log(`[JournalApp] Migrating ${cleanedHistory.length} entries from localStorage to DB`);
                    // Save to Supabase
                    await historyService.saveEntries(cleanedHistory);
                    setHistory(cleanedHistory);
                    // Clear migrated localStorage
                    if (legacyUserHistory) {
                      localStorage.removeItem(`serenity_journal_history_${currentUserId}`);
                    }
                    if (legacyHistory) {
                      localStorage.removeItem(LEGACY_HISTORY_KEY);
                    }
                    console.log('[JournalApp] ✅ Migration completed');
                  }
                } catch (e) {
                  console.error('Error migrating history:', e);
                }
              }
            } catch (error) {
              console.error('[JournalApp] Failed to load history from Supabase:', error);
              // Fallback to localStorage if Supabase fails
              const savedHistory = localStorage.getItem(currentHistoryKey);
              if (savedHistory) {
                try {
                  const parsed = JSON.parse(savedHistory);
                  const cleanedHistory = parsed.map((entry: any) => {
                    const { audioBase64, ...rest } = entry;
                    return rest;
                  });
                  setHistory(cleanedHistory);
                  console.log(`[JournalApp] ✅ Loaded ${cleanedHistory.length} entries from localStorage (fallback)`);
                } catch (e) {
                  console.error('Error parsing fallback history:', e);
                  setHistory([]);
                }
              } else {
                setHistory([]);
              }

              // Load auto-play preference from localStorage as fallback
              const savedAutoPlay = localStorage.getItem(currentAutoPlayKey);
              if (savedAutoPlay !== null) {
                setAutoPlayEnabled(savedAutoPlay === 'true');
              } else {
                setAutoPlayEnabled(false);
              }
              setPreferencesLoaded(true);
            }
          } else if (authStatus === 'authenticated' && session && !currentUserId && !isDemoMode) {
            // Session exists but no userId - might be loading or userId not set
            console.log('[JournalApp] Session authenticated but userId is null, waiting for session update...');
            // Don't set empty history yet, let it retry when userId becomes available
            return;
          } else {
            // No session and not demo mode
            setHistory([]);
            setAutoPlayEnabled(false);
            setPreferencesLoaded(true);
          }

          // Update refs AFTER data is loaded (only if we actually loaded)
          if (!isDemoMode && !currentUserId && authStatus === 'authenticated' && session?.user) {
            // Don't update refs yet - userId might not be available yet
            console.log('[JournalApp] Session authenticated but userId missing, not updating refs');
            return;
          }

          prevUserIdRef.current = currentUserId;
          prevDemoModeRef.current = currentDemoMode;
          isHydratedRef.current = true;
          setIsMounted(true);
        };

        loadData();
      } else if (authStatus === 'loading') {
        console.log('[JournalApp] Session still loading, waiting...');
      }
    }
  }, [userId, isDemoMode, session, authStatus]); // Re-run when user/demo/session/status changes

  // Wake Lock API and Page Visibility management for iOS/mobile
  // Prevents operations from stopping when screen turns off
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Request wake lock when operations are active (including audio playback)
    const requestWakeLock = async () => {
      const shouldKeepAwake = status === AppStatus.LOADING || isGeneratingVoice || isAudioSyncing || isPlayingAudio;

      if ('wakeLock' in navigator && shouldKeepAwake && !wakeLockRef.current) {
        try {
          const wakeLock = await (navigator as any).wakeLock.request('screen');
          wakeLockRef.current = wakeLock;
          console.log('[JournalApp] Wake lock acquired for background operations');
        } catch (err) {
          console.warn('[JournalApp] Wake lock not available:', err);
        }
      }
    };

    // Release wake lock when operations complete
    const releaseWakeLock = async () => {
      const shouldKeepAwake = status === AppStatus.LOADING || isGeneratingVoice || isAudioSyncing || isPlayingAudio;

      if (wakeLockRef.current && !shouldKeepAwake) {
        try {
          await wakeLockRef.current.release();
          wakeLockRef.current = null;
          console.log('[JournalApp] Wake lock released');
        } catch (err) {
          console.warn('[JournalApp] Error releasing wake lock:', err);
        }
      }
    };

    // Request wake lock when operations start (including audio playback)
    requestWakeLock();

    // Handle wake lock release (e.g., when screen is manually turned off)
    const handleWakeLockRelease = () => {
      console.log('[JournalApp] Wake lock released by system');
      wakeLockRef.current = null;
      // Re-request if operations are still active
      const shouldKeepAwake = status === AppStatus.LOADING || isGeneratingVoice || isAudioSyncing || isPlayingAudio;
      if (shouldKeepAwake) {
        requestWakeLock();
      }
    };

    if (wakeLockRef.current) {
      wakeLockRef.current.addEventListener('release', handleWakeLockRelease);
    }

    return () => {
      if (wakeLockRef.current) {
        wakeLockRef.current.removeEventListener('release', handleWakeLockRelease);
        releaseWakeLock();
      }
    };
  }, [status, isGeneratingVoice, isAudioSyncing, isPlayingAudio]);

  // Page Visibility API - Resume operations when app comes back to foreground
  // Also manages AudioContext state for background audio playback
  useEffect(() => {
    if (typeof document === 'undefined') return;

    const handleVisibilityChange = async () => {
      if (document.visibilityState === 'visible') {
        console.log('[JournalApp] App became visible, checking for pending operations');

        // Resume AudioContext if audio is playing (handle both suspended and interrupted states)
        if (isPlayingAudio && audioContextRef.current) {
          const ctxState = audioContextRef.current.state as string;
          if (ctxState === 'suspended' || ctxState === 'interrupted') {
            console.log(`[JournalApp] Resuming AudioContext for background audio playback (state: ${ctxState})`);
            try {
              await audioContextRef.current.resume();
              console.log('[JournalApp] AudioContext resumed successfully');
            } catch (error) {
              console.error('[JournalApp] Failed to resume AudioContext:', error);
            }
          }
        }

        // Resume any pending operations
        for (const [operationId, resumeFn] of pendingOperationsRef.current.entries()) {
          console.log(`[JournalApp] Resuming operation: ${operationId}`);
          try {
            await resumeFn();
            pendingOperationsRef.current.delete(operationId);
          } catch (error) {
            console.error(`[JournalApp] Failed to resume operation ${operationId}:`, error);
          }
        }

        // Re-request wake lock if operations are active (including audio playback)
        const shouldKeepAwake = status === AppStatus.LOADING || isGeneratingVoice || isAudioSyncing || isPlayingAudio;
        if (shouldKeepAwake) {
          if ('wakeLock' in navigator && !wakeLockRef.current) {
            try {
              const wakeLock = await (navigator as any).wakeLock.request('screen');
              wakeLockRef.current = wakeLock;
              console.log('[JournalApp] Wake lock re-acquired after visibility change');
            } catch (err) {
              console.warn('[JournalApp] Failed to re-acquire wake lock:', err);
            }
          }
        }
      } else if (document.visibilityState === 'hidden') {
        console.log('[JournalApp] App became hidden');

        // Ensure AudioContext stays running for background audio playback (handle suspended and interrupted)
        if (isPlayingAudio && audioContextRef.current) {
          const ctxState = audioContextRef.current.state as string;
          if (ctxState === 'suspended' || ctxState === 'interrupted') {
            console.log(`[JournalApp] App hidden but audio playing, attempting to resume AudioContext (state: ${ctxState})`);
            try {
              await audioContextRef.current.resume();
              console.log('[JournalApp] AudioContext resumed for background playback');
            } catch (error) {
              console.warn('[JournalApp] Could not resume AudioContext in background:', error);
            }
          }
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [status, isGeneratingVoice, isAudioSyncing, isPlayingAudio]);

  // Refetch history when switching to History view to ensure fresh data
  useEffect(() => {
    // Only refetch if we're switching to History view and component is mounted
    if (viewMode === ViewMode.HISTORY && isMounted) {
      if (!isDemoMode && userId) {
        // Authenticated mode: fetch from backend (only first page to avoid loading all history)
        console.log('[JournalApp] History view opened, refetching history from backend...');
        historyService.fetchHistory({ limit: 5, offset: 0 })
          .then((historyResult) => {
            // Handle both old format (array) and new format (object with entries)
            const loadedHistory = Array.isArray(historyResult)
              ? historyResult
              : historyResult.entries || [];
            console.log(`[JournalApp] ✅ Refetched ${loadedHistory.length} entries for History view`);
            setHistory(loadedHistory);
          })
          .catch((error) => {
            console.error('[JournalApp] Failed to refetch history for History view:', error);
            // Don't clear existing history on error, just log it
          });
      } else if (isDemoMode) {
        // Demo mode: reload from localStorage
        console.log('[JournalApp] History view opened, reloading history from localStorage...');
        const currentHistoryKey = getHistoryKey(userId, isDemoMode);
        const savedHistory = localStorage.getItem(currentHistoryKey);
        if (savedHistory) {
          try {
            const parsed = JSON.parse(savedHistory);
            const cleanedHistory = parsed.map((entry: any) => {
              const { audioBase64, ...rest } = entry;
              return rest;
            });
            console.log(`[JournalApp] ✅ Reloaded ${cleanedHistory.length} entries for History view (demo)`);
            setHistory(cleanedHistory);
          } catch (e) {
            console.error('[JournalApp] Error parsing demo history:', e);
          }
        }
      }
    }
  }, [viewMode, userId, isDemoMode, isMounted]); // Re-run when viewMode changes to HISTORY

  // Automatic background audio sync - runs periodically
  useEffect(() => {
    // Don't run if user is not authenticated or in demo mode
    if (!userId || isDemoMode) {
      console.log('[JournalApp] Audio sync skipped - no user or demo mode');
      return;
    }

    const runAudioSync = async () => {
      // Don't run if already syncing
      if (audioSyncRef.current) {
        console.log('[JournalApp] Audio sync already running, skipping');
        return;
      }

      // Check if sync should run (respects SYNC_INTERVAL timing)
      if (!shouldRunSync()) {
        console.log('[JournalApp] Audio sync not needed yet (too soon since last sync)');
        return;
      }

      // Check if there are entries that need syncing
      try {
        const stats = await getSyncStats();
        if (stats.entriesNeedingSync === 0) {
          console.log('[JournalApp] No audio entries need syncing');
          return;
        }

        console.log(`[JournalApp] Starting background audio sync for ${stats.entriesNeedingSync} entries...`);
        audioSyncRef.current = true;
        setIsAudioSyncing(true);

        // Silent background sync - don't show toast to avoid interrupting user
        // Wrap sync with retry logic for iOS background suspension
        const result = await withRetry(
          'sync-audio',
          () => syncAudioToDatabase((progress) => {
            setAudioSyncProgress(progress);
            // Log progress but don't show toast (background operation)
            if (progress.isComplete) {
              console.log(`[JournalApp] Audio sync complete: ${progress.saved} file(s) synced, ${progress.errors} error(s)`);
            }
          }),
          3,
          3000
        );

        if (result.success && result.saved > 0) {
          console.log(`[JournalApp] ✅ ${result.saved} audio file(s) synced to cloud`);
        } else if (result.errors > 0) {
          console.warn(`[JournalApp] ⚠️ Audio sync completed with ${result.errors} error(s)`);
        }
      } catch (error) {
        console.error('[JournalApp] Audio sync error:', error);
        // Don't show error toast - it's a background operation
      } finally {
        setIsAudioSyncing(false);
        setAudioSyncProgress(null);
        // Reset ref immediately to allow next scheduled sync
        audioSyncRef.current = false;
      }
    };

    // Run initial sync after a short delay to let the app load first
    const initialSyncTimeout = setTimeout(() => {
      runAudioSync();
    }, 5000); // 5 second initial delay

    // Set up periodic sync using setInterval
    const syncInterval = setInterval(() => {
      runAudioSync();
    }, SYNC_INTERVAL); // Use the same interval as defined in audioSync.ts (5 minutes)

    // Cleanup on unmount or when user/mode changes
    return () => {
      clearTimeout(initialSyncTimeout);
      clearInterval(syncInterval);
    };
  }, [userId, isDemoMode]);

  useEffect(() => {
    entryRef.current = entry;
    // Auto-resize textarea
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [entry]);

  // Draft auto-save removed - input field clears on refresh

  // Save history to Supabase (or localStorage for demo) whenever it changes
  useEffect(() => {
    if (typeof window !== 'undefined' && isHydratedRef.current) {
      // Don't save if we're in the middle of a user switch (prevUserId doesn't match current)
      const isUserMismatch = prevUserIdRef.current !== userId;
      if (isUserMismatch) {
        console.log('Skipping save - user mismatch:', { prev: prevUserIdRef.current, current: userId });
        return; // Skip save during user transition
      }

      if (isDemoMode) {
        // Demo mode: use localStorage
        const historyWithoutAudio = history.map(({ audioBase64, ...entry }) => entry);
        localStorage.setItem(currentHistoryKey, JSON.stringify(historyWithoutAudio));
        localStorage.setItem(currentAutoPlayKey, autoPlayEnabled.toString());
        console.log(`Saved ${history.length} entries to localStorage (demo mode)`);
      } else if (userId) {
        // Authenticated: use Supabase
        const saveToSupabase = async () => {
          // Check again before saving (user might have changed)
          if (prevUserIdRef.current !== userId) {
            console.log('Aborting save - user changed during async operation');
            return; // User changed, don't save
          }

          console.log(`Attempting to save ${history.length} entries for user: ${userId}`);

          try {
            // Save preferences always, save history only if it exists
            const savePromises = [
              historyService.savePreferences({ auto_play_enabled: autoPlayEnabled }),
            ];

            if (history.length > 0) {
              savePromises.push(historyService.saveEntries(history));
            }

            const results = await Promise.allSettled(savePromises);

            // Check preferences result (first promise)
            if (results[0].status === 'rejected') {
              console.error('Failed to save preferences:', results[0].reason);
            } else {
              console.log('Preferences saved successfully');
            }

            // Check history result (if it was saved)
            if (history.length > 0) {
              const historyResult = results[1];
              if (historyResult.status === 'rejected') {
                console.error('Failed to save history:', historyResult.reason);
                // Fallback to localStorage for history
                const historyWithoutAudio = history.map(({ audioBase64, ...entry }) => entry);
                localStorage.setItem(currentHistoryKey, JSON.stringify(historyWithoutAudio));
              } else {
                console.log(`✅ Successfully saved ${history.length} entries to database for user ${userId}`);
              }
            }

            // Save preferences to localStorage as backup
            localStorage.setItem(currentAutoPlayKey, autoPlayEnabled.toString());
          } catch (error) {
            console.error('Unexpected error saving to Supabase:', error);
            // Fallback to localStorage if Supabase fails
            const historyWithoutAudio = history.map(({ audioBase64, ...entry }) => entry);
            localStorage.setItem(currentHistoryKey, JSON.stringify(historyWithoutAudio));
            localStorage.setItem(currentAutoPlayKey, autoPlayEnabled.toString());
          }
        };

        saveToSupabase();
      }
    } else if (typeof window !== 'undefined' && !isHydratedRef.current) {
      console.log('Skipping save - not yet hydrated');
    }
  }, [history, autoPlayEnabled, isDemoMode, userId, currentHistoryKey, currentAutoPlayKey]);

  // Monitor AudioContext state and keep it running during audio playback
  // Critical for iOS background audio playback when screen turns off
  useEffect(() => {
    if (!isPlayingAudio || !audioContextRef.current) return;

    const checkAndResumeAudioContext = async () => {
      if (audioContextRef.current && isPlayingAudio) {
        const ctxState = audioContextRef.current.state as string;
        if (ctxState === 'suspended' || ctxState === 'interrupted') {
          console.log(`[JournalApp] AudioContext ${ctxState} during playback, attempting to resume...`);
          try {
            await audioContextRef.current.resume();
            console.log('[JournalApp] AudioContext resumed successfully for background playback');
          } catch (error) {
            console.warn('[JournalApp] Failed to resume AudioContext:', error);
          }
        }
      }
    };

    // Check immediately
    checkAndResumeAudioContext();

    // Set up periodic check (every 2 seconds) to ensure AudioContext stays running
    const interval = setInterval(checkAndResumeAudioContext, 2000);

    // Also listen for state changes (handle both suspended and interrupted)
    const handleStateChange = () => {
      if (audioContextRef.current && isPlayingAudio) {
        const ctxState = audioContextRef.current.state as string;
        if (ctxState === 'suspended' || ctxState === 'interrupted') {
          console.log(`[JournalApp] AudioContext state changed to ${ctxState}, resuming...`);
          audioContextRef.current.resume().catch(console.error);
        }
      }
    };

    if (audioContextRef.current) {
      // Note: AudioContext doesn't have a direct statechange event, so we use interval
      // But we can listen for visibility changes which we already handle
    }

    return () => {
      clearInterval(interval);
    };
  }, [isPlayingAudio]);

  // Cleanup AudioContext on unmount
  useEffect(() => {
    return () => {
      stopCurrentAudio();
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(console.error);
        audioContextRef.current = null;
      }
    };
  }, []);

  const stopCurrentAudio = () => {
    // Signal that playback should stop - increment session ID to invalidate all pending callbacks
    playbackSessionIdRef.current += 1;
    shouldContinuePlayingRef.current = false;
    currentPlaybackIdRef.current = null;

    if (currentAudioSourceRef.current) {
      try {
        // Disconnect and stop the source
        currentAudioSourceRef.current.onended = null; // Remove callback
        currentAudioSourceRef.current.stop();
      } catch (e) { }
      currentAudioSourceRef.current = null;
    }

    // Clear state
    setIsPlayingAudio(false);
    setIsPaused(false);
    setActiveAudioId(null);
    audioChunksRef.current = [];
    currentChunkIndexRef.current = 0;
  };

  const pauseCurrentAudio = () => {
    if (!shouldContinuePlayingRef.current) return; // Don't pause if already stopped

    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.suspend().then(() => {
        if (shouldContinuePlayingRef.current) { // Check again after async operation
          setIsPaused(true);
        }
      }).catch(console.error);
    }
  };

  const resumeCurrentAudio = () => {
    if (!shouldContinuePlayingRef.current) return; // Don't resume if stopped

    if (audioContextRef.current) {
      const ctxState = audioContextRef.current.state as string;
      if (ctxState === 'suspended' || ctxState === 'interrupted') {
        audioContextRef.current.resume().then(() => {
          if (shouldContinuePlayingRef.current) { // Check again after async operation
            setIsPaused(false);
          }
        }).catch(console.error);
      }
    }
  };

  // Detect if audio is compressed (from database) or raw PCM (from cache/generation)
  const isCompressedAudio = (base64Audio: string): boolean => {
    // Check the first few bytes after decoding to detect file format
    try {
      // Decode first 100 base64 characters (roughly 75 bytes)
      const sample = base64Audio.substring(0, Math.min(100, base64Audio.length));
      const binaryString = atob(sample);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Check for common compressed audio file signatures
      if (bytes.length >= 4) {
        // WebM: 0x1A 0x45 0xDF 0xA3
        if (bytes[0] === 0x1A && bytes[1] === 0x45 && bytes[2] === 0xDF && bytes[3] === 0xA3) {
          return true; // WebM
        }
        // MP3: 0xFF 0xFB or 0xFF 0xF3 or 'ID3'
        if ((bytes[0] === 0xFF && (bytes[1] === 0xFB || bytes[1] === 0xF3)) ||
          (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33)) {
          return true; // MP3
        }
        // OGG: 'OggS'
        if (bytes[0] === 0x4F && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) {
          return true; // OGG
        }
        // WAV: 'RIFF' (though we shouldn't have WAV from optimization)
        if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
          return true; // WAV
        }
      }
    } catch (e) {
      // If we can't check, assume PCM (safer fallback for existing audio)
      console.warn('Could not detect audio format, assuming PCM:', e);
    }

    return false;
  };

  // Get MIME type for compressed audio
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
      // Default to webm (most common from MediaRecorder)
    }
    return 'audio/webm'; // Default
  };

  const playAudioChunk = async (
    base64Audio: string,
    id: string | number,
    onComplete?: () => void,
    sessionId?: number
  ): Promise<void> => {
    try {
      // Create or get AudioContext - on mobile this must be done within user interaction
      // IMPORTANT: On mobile browsers, AudioContext must be created/resumed within user interaction handler
      let ctx = audioContextRef.current;

      if (!ctx) {
        ctx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        audioContextRef.current = ctx;
        console.log('[playAudioChunk] AudioContext created, state:', ctx.state);
      }

      // On mobile, AudioContext often starts in 'suspended' or 'interrupted' state and must be resumed
      // 'suspended' = user interaction required, 'interrupted' = system interrupted (phone call, notification, etc.)
      // This is a security feature - audio can only play after user interaction
      const ctxState = ctx.state as string;
      if (ctxState === 'suspended' || ctxState === 'interrupted') {
        const stateMsg = ctxState === 'interrupted' ? 'interrupted (system event)' : 'suspended';
        console.log(`[playAudioChunk] AudioContext ${stateMsg}, attempting to resume...`);
        try {
          await ctx.resume();
          console.log('[playAudioChunk] AudioContext resumed, new state:', ctx.state);

          // Double-check - sometimes resume() doesn't work immediately on mobile
          const newState = ctx.state as string;
          if (newState === 'suspended' || newState === 'interrupted') {
            console.log(`[playAudioChunk] Still ${newState} after resume, waiting...`);
            await new Promise(resolve => setTimeout(resolve, 100));
            const finalState = ctx.state as string;
            if (finalState === 'suspended' || finalState === 'interrupted') {
              await ctx.resume();
            }
          }
        } catch (resumeError) {
          console.error('[playAudioChunk] Failed to resume AudioContext:', resumeError);
          // On mobile, sometimes we need to create a new context within the user interaction
          try {
            console.log('[playAudioChunk] Creating new AudioContext as fallback...');
            ctx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
            audioContextRef.current = ctx;
            console.log('[playAudioChunk] New AudioContext created, state:', ctx.state);
          } catch (createError) {
            console.error('[playAudioChunk] Failed to create new AudioContext:', createError);
            throw new Error('Failed to initialize audio. Please try again.');
          }
        }
      }

      // Ensure context is running - critical for mobile
      // Final check before proceeding (handle both suspended and interrupted states)
      const finalCtxState = ctx.state as string;
      if (finalCtxState === 'suspended' || finalCtxState === 'interrupted') {
        console.log(`[playAudioChunk] Final resume attempt for ${finalCtxState} state...`);
        await ctx.resume();
        // Wait a bit and check again
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      if (ctx.state !== 'running') {
        // If still not running, provide helpful error message
        const currentState = ctx.state as string;
        const stateMsg = currentState === 'interrupted'
          ? 'interrupted (may be due to phone call, notification, or other audio)'
          : currentState;
        const errorMsg = `AudioContext is ${stateMsg}. Audio playback requires user interaction. Please tap the play button again.`;
        console.error('[playAudioChunk]', errorMsg);
        showToast('Audio requires interaction. Please tap play again.', 'error');
        throw new Error(errorMsg);
      }

      console.log('[playAudioChunk] AudioContext ready, state:', ctx.state);

      let buffer: AudioBuffer;

      // Always decode with native decoder as we now get compressed audio (MP3)
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
      // CRITICAL for iOS: Explicitly set gain value (iOS Safari can default to 0)
      gainNode.gain.value = 1.0;
      source.connect(gainNode);
      gainNode.connect(ctx.destination);

      return new Promise<void>((resolve) => {
        // Detect iOS device for special timing handling
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
          (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

        // Track playback start time to ensure full duration plays
        // The onended event can fire 1-2 seconds early with compressed audio from database
        // iOS Safari has known issues with onended firing early consistently
        // Use an object so we can update the time when playback actually starts
        const timingInfo = {
          startTime: Date.now(), // Will be updated when playback actually starts
          expectedDurationMs: (buffer.duration / playbackRate) * 1000
        };

        source.onended = () => {
          currentAudioSourceRef.current = null;

          // CRITICAL: Check session ID first - if session was cancelled, don't continue
          if (sessionId !== undefined && playbackSessionIdRef.current !== sessionId) {
            resolve();
            return;
          }

          // Calculate how much time has actually elapsed since playback started
          const timeElapsed = Date.now() - timingInfo.startTime;
          const remainingTime = timingInfo.expectedDurationMs - timeElapsed;

          // iOS-specific handling: onended fires 1-2 seconds early consistently
          // For iOS, we need a larger buffer and should trust buffer.duration more
          let safetyBuffer: number;
          if (isIOS) {
            // iOS: Add 1.5-2 second buffer to account for consistent early firing
            // Also add extra buffer based on audio length (longer audio = more early)
            const iosBuffer = Math.max(1500, Math.min(2000, timingInfo.expectedDurationMs * 0.1));
            safetyBuffer = iosBuffer;
            console.log(`[playAudioChunk] iOS device detected, using ${iosBuffer.toFixed(0)}ms buffer`);
          } else {
            // Other platforms: 200ms buffer is usually sufficient
            safetyBuffer = 200;
          }

          const waitTime = Math.max(0, remainingTime) + safetyBuffer;

          // Use a dynamic cap: allow waiting up to 1.5x the expected duration, with a minimum of 30s
          // For iOS, we're more aggressive since we know onended fires early
          // Example: 20s audio -> cap at 30s, 40s audio -> cap at 60s, 60s audio -> cap at 90s
          const dynamicCap = Math.max(30000, timingInfo.expectedDurationMs * 1.5);
          const cappedWaitTime = Math.min(waitTime, dynamicCap);

          if (waitTime > dynamicCap) {
            console.warn(`[playAudioChunk] onended fired very early: ${timeElapsed.toFixed(0)}ms elapsed, expected ${timingInfo.expectedDurationMs.toFixed(0)}ms. Waiting ${cappedWaitTime.toFixed(0)}ms (capped from ${waitTime.toFixed(0)}ms, dynamic cap: ${dynamicCap.toFixed(0)}ms)`);
          } else {
            const platform = isIOS ? 'iOS' : 'other';
            console.log(`[playAudioChunk] [${platform}] onended fired after ${timeElapsed.toFixed(0)}ms, expected ${timingInfo.expectedDurationMs.toFixed(0)}ms, waiting ${cappedWaitTime.toFixed(0)}ms more (buffer: ${safetyBuffer.toFixed(0)}ms)`);
          }

          setTimeout(() => {
            // Only call onComplete if playback should continue
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
          setIsPaused(false);
          setActiveAudioId(null);

          // Provide user-friendly error message
          const errorMsg = error?.message || 'Unknown audio error';
          if (errorMsg.includes('NotAllowedError') || errorMsg.includes('NotSupportedError')) {
            showToast('Audio playback not allowed. Please check device permissions.', 'error');
          } else {
            showToast('Error playing audio. Please try again.', 'error');
          }
          resolve();
        });

        // Check if we should still play before starting - also check session ID
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
        setIsPaused(false);
        setActiveAudioId(id);

        // Note: Wake lock will be automatically requested via useEffect when isPlayingAudio becomes true
        // This ensures audio continues playing even when screen turns off on iOS

        // Double-check context is running before starting (mobile requirement)
        // Use .then() since we're inside a Promise executor (can't use await)
        const ensureContextRunning = async () => {
          let currentState = ctx.state as string;
          if (currentState !== 'running') {
            const stateMsg = currentState === 'interrupted' ? 'interrupted (system event)' : currentState;
            console.log(`[playAudioChunk] Context not running before start (${stateMsg}), attempting to resume...`);
            await ctx.resume();
            // Wait a bit for state to update
            await new Promise(resolve => setTimeout(resolve, 50));
            // Store state after resume to avoid TypeScript type narrowing issues
            currentState = ctx.state as string;
            if (currentState !== 'running') {
              const errorStateMsg = currentState === 'interrupted'
                ? 'interrupted (may be due to phone call, notification, or other audio)'
                : currentState;
              throw new Error(`AudioContext is ${errorStateMsg}, cannot start playback`);
            }
          }
        };

        ensureContextRunning()
          .then(async () => {
            try {
              // iOS Safari sometimes needs a small delay after connecting audio graph
              // Wait a tiny bit to ensure audio graph is fully initialized
              await new Promise(resolve => setTimeout(resolve, 10));

              // Update start time right when playback actually begins
              timingInfo.startTime = Date.now();
              source.start(0);
              console.log('[playAudioChunk] Audio started successfully');
            } catch (startError: any) {
              throw startError;
            }
          })
          .catch((error: any) => {
            console.error('Error starting audio:', error);
            currentAudioSourceRef.current = null;
            shouldContinuePlayingRef.current = false;
            currentPlaybackIdRef.current = null;
            setIsPlayingAudio(false);
            setActiveAudioId(null);

            // User-friendly error message
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
    audioData: string | string[] | ReadableStream<Uint8Array>,
    id: string | number = 'main'
  ) => {
    stopCurrentAudio();

    // Handle streaming audio (ReadableStream) - PRIMARY METHOD
    if (audioData instanceof ReadableStream) {
      try {
        const player = await createProgressiveAudioPlayer();

        // Update state immediately - playback will start in 2-3 seconds
        setIsPlayingAudio(true);
        setIsPaused(false);
        setActiveAudioId(id);

        // Start playback asynchronously (don't await - let it run in background)
        player.play(audioData).then(() => {
          // Playback completed successfully
          console.log('[playAudio] Streaming playback completed');
          setIsPlayingAudio(false);
          setIsPaused(false);
          setActiveAudioId(null);
        }).catch((error) => {
          console.error('Error during streaming playback:', error);
          showToast('Error playing audio', 'error');
          setIsPlayingAudio(false);
          setIsPaused(false);
          setActiveAudioId(null);
        });
      } catch (error) {
        console.error('Error initializing streaming audio:', error);
        showToast('Error playing audio', 'error');
        setIsPlayingAudio(false);
        setActiveAudioId(null);
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

    // Set up playback tracking - create new session
    const sessionId = ++playbackSessionIdRef.current;
    shouldContinuePlayingRef.current = true;
    currentPlaybackIdRef.current = id;
    audioChunksRef.current = chunks;
    currentChunkIndexRef.current = 0;

    // Play chunks sequentially
    const playNextChunk = async (index: number, currentSessionId: number) => {
      // Check session ID first - if it doesn't match, this playback was cancelled
      if (playbackSessionIdRef.current !== currentSessionId) {
        return; // This session is no longer active
      }

      // Check if we should continue playing - use ref for immediate check
      if (!shouldContinuePlayingRef.current || currentPlaybackIdRef.current !== id) {
        if (playbackSessionIdRef.current === currentSessionId) {
          setIsPlayingAudio(false);
          setIsPaused(false);
          setActiveAudioId(null);
          audioChunksRef.current = [];
          currentChunkIndexRef.current = 0;
        }
        return;
      }

      // Check if we've finished all chunks
      if (index >= chunks.length) {
        if (playbackSessionIdRef.current === currentSessionId) {
          shouldContinuePlayingRef.current = false;
          currentPlaybackIdRef.current = null;
          setIsPlayingAudio(false);
          setIsPaused(false);
          setActiveAudioId(null);
          audioChunksRef.current = [];
          currentChunkIndexRef.current = 0;
        }
        return;
      }

      // Check if another audio has taken over
      if (activeAudioId !== null && activeAudioId !== id) {
        shouldContinuePlayingRef.current = false;
        currentPlaybackIdRef.current = null;
        return; // Another audio is playing, stop this one
      }

      try {
        await playAudioChunk(chunks[index], id, () => {
          // CRITICAL: Check session ID at the START of callback
          if (playbackSessionIdRef.current !== currentSessionId) {
            return; // Session cancelled, don't continue
          }

          // Move to next chunk after this one completes
          // Check refs first for immediate state check
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
              setIsPaused(false);
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
          setIsPaused(false);
          setActiveAudioId(null);
          audioChunksRef.current = [];
          currentChunkIndexRef.current = 0;
        }
      }
    };

    playNextChunk(0, sessionId);
  };

  const setPlaybackSpeed = (rate: number) => {
    setPlaybackRate(rate);
    if (currentAudioSourceRef.current && currentAudioSourceRef.current.playbackRate) {
      currentAudioSourceRef.current.playbackRate.value = rate;
    }
  };

  const updateHistoryWithChat = (messages: ChatMessage[]) => {
    if (!currentHistoryId) return;
    setHistory(prev => prev.map(h =>
      h.id === currentHistoryId ? { ...h, chatHistory: messages } : h
    ));
  };

  // Initialize AudioContext on user interaction (critical for mobile)
  const ensureAudioContext = () => {
    if (!audioContextRef.current) {
      try {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        console.log('[ensureAudioContext] AudioContext created on user interaction');
      } catch (error) {
        console.error('[ensureAudioContext] Failed to create AudioContext:', error);
        showToast('Audio not supported on this device', 'error');
      }
    }
    return audioContextRef.current;
  };

  const handleTogglePlayback = async () => {
    console.log('[handleTogglePlayback] Called', {
      isPlayingAudio,
      activeAudioId,
      isPaused,
      hasReflection: !!reflection,
      hasCurrentAudioBase64: !!currentAudioBase64
    });

    // Ensure AudioContext is created/resumed on user interaction (required for mobile)
    ensureAudioContext();

    if (isPlayingAudio && activeAudioId === 'main') {
      console.log('[handleTogglePlayback] Path: Toggle pause/resume');
      if (isPaused) {
        resumeCurrentAudio();
      } else {
        pauseCurrentAudio();
      }
    } else if (isPaused && activeAudioId === 'main') {
      console.log('[handleTogglePlayback] Path: Resume from pause');
      resumeCurrentAudio();
    } else {
      if (currentAudioBase64 && (activeAudioId !== 'main' || !isPlayingAudio)) {
        console.log('[handleTogglePlayback] Path: Play existing currentAudioBase64');
        const audioData = typeof currentAudioBase64 === 'string'
          ? currentAudioBase64
          : Array.isArray(currentAudioBase64)
            ? currentAudioBase64
            : [currentAudioBase64];
        playAudio(audioData, 'main');
      } else if (reflection) {
        console.log('[handleTogglePlayback] Path: Generate new audio for reflection');
        setIsGeneratingVoice(true);
        setGeneratingAudioId('main');
        try {
          // Check cache first
          console.log('[handleTogglePlayback] Checking IndexedDB cache...');
          const cached = await audioCache.get(reflection.content);
          console.log('[handleTogglePlayback] Cache result:', cached ? `found (${typeof cached})` : 'not found');
          if (cached) {
            const audioData = typeof cached === 'string' ? cached : [cached];
            setCurrentAudioBase64(audioData);
            playAudio(audioData, 'main');
          } else {
            // Use direct streaming for immediate playback (like test page)
            console.log('[JournalApp] Generating streaming audio for reflection...');
            const streamStartTime = Date.now();
            const audioStream = await generateSpeechStream(reflection.content);

            if (audioStream) {
              const fetchTime = Date.now() - streamStartTime;
              console.log(`[JournalApp] ✅ Audio stream received in ${fetchTime}ms, starting progressive playback...`);

              // Clear loading state immediately - playback will start in 2-3 seconds
              setIsGeneratingVoice(false);
              setGeneratingAudioId(null);

              // Play stream directly for progressive playback (don't await - it runs async)
              playAudio(audioStream, 'main');
              console.log('[JournalApp] ✅ Playback initiated (will start in 2-3s as stream buffers)');

              // Note: We can't easily cache streaming audio since it's consumed during playback
              // The cache will be populated next time when we use the generateSpeech fallback
            } else {
              // Fallback to old method if streaming not available
              console.log('[JournalApp] Streaming not available, falling back to base64 method...');
              const audioResult = await generateSpeech(reflection.content, {
                chunked: reflection.content.length > 1500
              });

              if (audioResult) {
                const audioData = Array.isArray(audioResult) ? audioResult : [audioResult];
                setCurrentAudioBase64(audioData);

                // Cache the audio
                if (typeof audioResult === 'string') {
                  await audioCache.set(reflection.content, audioResult);

                  // Automatically save to database when audio is first generated
                  if (userId && !isDemoMode && currentHistoryId) {
                    historyService.saveEntryAudio(currentHistoryId, audioResult)
                      .then(() => {
                        console.log(`[JournalApp] ✅ Audio saved to database for entry ${currentHistoryId}`);
                      })
                      .catch(saveErr => {
                        console.error('[JournalApp] Failed to save audio to database:', saveErr);
                      });
                  }
                }

                // Play the audio
                playAudio(audioData, 'main');
              } else {
                showToast('Could not generate audio. Please try again.', 'error');
              }
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
    }
  };

  const handleHistoryAudioPlayback = async (text: string, id: string) => {
    // Ensure AudioContext is created/resumed on user interaction (required for mobile)
    ensureAudioContext();

    // Audio can be in: 1) history entry (from database), 2) IndexedDB cache, 3) needs generation

    if (isPlayingAudio && activeAudioId === id) {
      if (isPaused) {
        resumeCurrentAudio();
      } else {
        pauseCurrentAudio();
      }
      return;
    }

    setGeneratingAudioId(id);
    setIsGeneratingVoice(true);
    try {
      // Priority: 1) In-memory audio (from history entry), 2) Database audio (on-demand), 3) Local cache, 4) Generate new
      const entryId = id.replace('history-', '');
      const historyEntry = history.find(h => h.id === entryId);
      let audioData: string | string[] | ReadableStream<Uint8Array> | null = null;

      // Check if audio is already in memory (from history entry)
      if (historyEntry?.audioBase64) {
        audioData = typeof historyEntry.audioBase64 === 'string'
          ? historyEntry.audioBase64
          : Array.isArray(historyEntry.audioBase64)
            ? historyEntry.audioBase64
            : null;

        if (audioData) {
          // Cache locally for faster future access
          if (typeof historyEntry.audioBase64 === 'string') {
            await audioCache.set(text, historyEntry.audioBase64);
          }
          setIsGeneratingVoice(false);
          setGeneratingAudioId(null);
          playAudio(audioData, id);
          return;
        }
      }

      // Check local cache (IndexedDB) - fastest option if available
      const cached = await audioCache.get(text);
      if (cached) {
        audioData = typeof cached === 'string' ? cached : [cached];
        setIsGeneratingVoice(false);
        setGeneratingAudioId(null);
        playAudio(audioData, id);
        return;
      }

      // Try to fetch from database (optimized with streaming response)
      // Only fetch if we have a valid entry ID and user is authenticated
      if (entryId && userId && !isDemoMode) {
        console.log(`[handleHistoryAudioPlayback] Checking database for cached audio for entry ${entryId}...`);

        try {
          // Fetch with streaming=true to get binary stream instead of JSON
          const response = await fetch(`/api/history/audio?entryId=${encodeURIComponent(entryId)}&streaming=true`, {
            method: 'GET',
          });

          if (response.ok && response.body) {
            console.log(`[handleHistoryAudioPlayback] ✅ Got cached audio stream from database, starting playback...`);
            setIsGeneratingVoice(false);
            setGeneratingAudioId(null);
            playAudio(response.body, id);
            return;
          }
        } catch (fetchError) {
          console.warn('[handleHistoryAudioPlayback] Database streaming fetch failed:', fetchError);
        }
      }

      // Generate new audio with STREAMING for progressive playback (like main reflection)
      console.log('[handleHistoryAudioPlayback] No cached audio found, generating with streaming...');
      const streamStartTime = Date.now();
      const audioStream = await generateSpeechStream(text);

      if (audioStream) {
        const fetchTime = Date.now() - streamStartTime;
        console.log(`[handleHistoryAudioPlayback] ✅ Audio stream received in ${fetchTime}ms, starting progressive playback...`);

        // Clear loading state immediately - playback will start in 2-3 seconds
        setIsGeneratingVoice(false);
        setGeneratingAudioId(null);

        // Play stream directly for progressive playback (don't await - it runs async)
        playAudio(audioStream, id);
        console.log('[handleHistoryAudioPlayback] ✅ Playback initiated (will start in 2-3s as stream buffers)');

        // Note: We can't easily cache streaming audio since it's consumed during playback
        // The cache will be populated next time when we use the generateSpeech fallback
      } else {
        // Fallback to old base64 method if streaming not available
        console.log('[handleHistoryAudioPlayback] Streaming not available, falling back to base64 method...');
        const needsChunking = text.length > 1500;
        const audioResult = await withRetry(
          `generate-tts-${id}`,
          () => generateSpeech(text, {
            chunked: needsChunking
          }),
          3,
          2000
        );

        if (audioResult) {
          audioData = Array.isArray(audioResult) ? audioResult : [audioResult];

          // Cache locally
          if (typeof audioResult === 'string') {
            await audioCache.set(text, audioResult);

            // Optimize and sync to database for cross-device access
            if (userId && !isDemoMode && historyEntry?.id) {
              historyService.saveEntryAudio(historyEntry.id, audioResult)
                .then(() => {
                  console.log(`[handleHistoryAudioPlayback] ✅ Audio saved to database for entry ${historyEntry.id}`);
                })
                .catch(saveErr => {
                  console.error('[handleHistoryAudioPlayback] Failed to save audio to database:', saveErr);
                  // Log error but don't throw - audio is cached locally
                });
            }
          }

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
    // Ensure AudioContext is created/resumed on user interaction (required for mobile)
    ensureAudioContext();

    const id = `chat-${index}`;
    const msg = chatMessages[index];

    if (isPlayingAudio && activeAudioId === id) {
      if (isPaused) {
        resumeCurrentAudio();
      } else {
        pauseCurrentAudio();
      }
    } else if (isPaused && activeAudioId === id) {
      resumeCurrentAudio();
    } else {
      if (msg?.audioBase64) {
        const audioData = typeof msg.audioBase64 === 'string'
          ? msg.audioBase64
          : Array.isArray(msg.audioBase64)
            ? msg.audioBase64
            : [msg.audioBase64];
        playAudio(audioData, id);
        return;
      }

      setGeneratingAudioId(id);
      setIsGeneratingVoice(true);
      try {
        // Check cache first
        const cached = await audioCache.get(text);
        if (cached) {
          const audioData = typeof cached === 'string' ? cached : [cached];
          const updatedMessages = chatMessages.map((m, i) =>
            i === index ? { ...m, audioBase64: audioData } : m
          );
          setChatMessages(updatedMessages);
          updateHistoryWithChat(updatedMessages);
          playAudio(audioData, id);
        } else {
          // Generate with chunking for long texts, with retry logic for iOS background suspension
          const needsChunking = text.length > 1500;
          const audioResult = await withRetry(
            `generate-tts-chat-${index}`,
            () => generateSpeech(text, {
              chunked: needsChunking
            }),
            3,
            2000
          );

          if (audioResult) {
            const audioData = Array.isArray(audioResult) ? audioResult : [audioResult];
            const updatedMessages = chatMessages.map((m, i) =>
              i === index ? { ...m, audioBase64: audioData } : m
            );
            setChatMessages(updatedMessages);
            updateHistoryWithChat(updatedMessages);

            // Cache the audio
            if (typeof audioResult === 'string') {
              await audioCache.set(text, audioResult);

              // Automatically save to database when audio is first generated (for chat messages)
              // Note: Chat audio is typically not saved per message, but if there's a history entry,
              // we could save it. For now, we'll just cache it since chat messages aren't persisted individually.
            }

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

  // Helper function to wrap operations with retry logic for iOS background suspension
  const withRetry = async <T,>(
    operationId: string,
    operation: () => Promise<T>,
    maxRetries = 3,
    retryDelay = 1000
  ): Promise<T> => {
    ongoingOperationsRef.current.add(operationId);

    const attemptOperation = async (attempt: number): Promise<T> => {
      try {
        const result = await operation();
        ongoingOperationsRef.current.delete(operationId);
        return result;
      } catch (error) {
        // Check if error is due to background suspension (network error, timeout)
        const isSuspensionError = error instanceof Error && (
          error.message.includes('network') ||
          error.message.includes('timeout') ||
          error.message.includes('aborted') ||
          error.message.includes('Failed to fetch')
        );

        if (isSuspensionError && attempt < maxRetries) {
          console.log(`[JournalApp] Operation ${operationId} suspended, retrying (attempt ${attempt + 1}/${maxRetries})...`);

          // Store operation for resume if app goes to background
          pendingOperationsRef.current.set(operationId, async () => {
            return attemptOperation(attempt + 1);
          });

          // Wait before retry
          await new Promise(resolve => setTimeout(resolve, retryDelay * attempt));
          return attemptOperation(attempt + 1);
        }

        ongoingOperationsRef.current.delete(operationId);
        pendingOperationsRef.current.delete(operationId);
        throw error;
      }
    };

    return attemptOperation(1);
  };

  const handleEntryChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setEntry(e.target.value);
  };

  const handleGetReflection = useCallback(async () => {
    if (!entry.trim()) return;

    setStatus(AppStatus.LOADING);
    setError(null);
    setIsChatting(false);
    setChatMessages([]);
    chatSessionRef.current = null;
    setCurrentAudioBase64(null);
    setReflectionProgress(null); // Clear previous progress
    stopCurrentAudio();

    try {
      // Clear context revalidation indicator when new reflection is generated
      if (contextRevalidated) {
        setContextRevalidated(false);
      }

      // Wrap with retry logic for iOS background suspension
      const { reflection: content, summary, topic, mood: detectedMood, entities, highlights, tokenUsage } = await withRetry(
        'get-reflection',
        () => getJournalReflection(entry, selectedMood, history, (progress) => {
          console.log('[JournalApp] Progress update:', progress.stage, progress.message);
          setReflectionProgress(progress);
        }),
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
      console.log(`[JournalApp] Received reflection with topic: "${topic}", mood: "${detectedMood}", entities:`, entities, 'highlights:', highlights);
      const newReflection = {
        content,
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

      const newHistoryEntry: HistoryEntry = {
        id: newId,
        text: entry,
        summary: summary,
        reflection: content,
        mood: detectedMood || selectedMood, // Use AI-detected mood, fallback to selected
        topic: topic,
        timestamp: new Date().toISOString(),
        chatHistory: [],
        entities: entities, // Save extracted entities
        highlights: highlights // Save AI-detected highlights
      };
      console.log(`[JournalApp] Created history entry with topic: "${topic}", entities:`, entities, 'highlights:', highlights);

      setHistory(prev => [newHistoryEntry, ...prev]);

      // Save entry to database (without audio first, audio will be added after generation)
      // The entry will be saved via useEffect, but we'll also save audio separately when it's ready
      if (userId && !isDemoMode) {
        setTimeout(() => {
          if (isHydratedRef.current) {
            console.log(`[JournalApp] Immediately saving new entry ${newId} for user ${userId}`);
            // Save entry without audio initially (audio will be saved separately after generation)
            historyService.saveEntries([newHistoryEntry], false).catch(error => {
              console.error('[JournalApp] Failed to immediately save new entry:', error);
            });
          } else {
            console.log('[JournalApp] Not hydrated yet, will save via useEffect');
          }
        }, 100);
      }

      // Only auto-generate audio if auto-play is enabled
      // If auto-play is disabled, audio will be generated on-demand when user clicks play
      console.log(`[JournalApp] Auto-play enabled: ${autoPlayEnabled}, Preferences loaded: ${preferencesLoaded}`);
      if (autoPlayEnabled) {
        console.log('[JournalApp] Auto-generating audio because auto-play is enabled');
        setIsGeneratingVoice(true);
        setGeneratingAudioId('main');

        (async () => {
          try {
            // Check cache first
            const cached = await audioCache.get(content);

            if (cached) {
              console.log('[JournalApp] Auto-play using cached audio');
              // Use cached audio
              const audioData = typeof cached === 'string' ? [cached] : cached;
              setCurrentAudioBase64(audioData);

              // Store cached audio with history entry
              setHistory(prev => prev.map(h =>
                h.id === newId ? { ...h, audioBase64: cached } : h
              ));

              // Clear loading state and play
              setIsGeneratingVoice(false);
              setGeneratingAudioId(null);
              playAudio(audioData, 'main');
            } else {
              // Use streaming for immediate playback (just like manual play)
              console.log('[JournalApp] Auto-play using streaming audio...');
              const streamStartTime = Date.now();
              const audioStream = await generateSpeechStream(content);

              if (audioStream) {
                const fetchTime = Date.now() - streamStartTime;
                console.log(`[JournalApp] Auto-play: Audio stream received in ${fetchTime}ms, starting progressive playback...`);

                // Clear loading state immediately - playback will start in 2-3 seconds
                setIsGeneratingVoice(false);
                setGeneratingAudioId(null);

                // Play stream directly for progressive playback
                playAudio(audioStream, 'main');
                console.log('[JournalApp] Auto-play: Playback initiated (will start in 2-3s)');

                // Note: Streaming audio can't be easily cached since it's consumed during playback
                // On next play, we'll fall back to generateSpeech which will cache it
              } else {
                // Fallback to old method if streaming not available
                console.log('[JournalApp] Auto-play: Streaming not available, falling back to base64...');
                const generated = await withRetry(
                  'generate-tts-main',
                  () => generateSpeech(content, { chunked: content.length > 1500 }),
                  3,
                  2000
                );

                if (!generated) {
                  showToast('Could not generate audio automatically.', 'error');
                  setIsGeneratingVoice(false);
                  setGeneratingAudioId(null);
                  return;
                }

                const audioData = Array.isArray(generated) ? generated : [generated];
                setCurrentAudioBase64(audioData);

                // Update history entry with audio
                const audioResult = typeof generated === 'string' ? generated : generated[0];
                setHistory(prev => prev.map(h =>
                  h.id === newId ? { ...h, audioBase64: audioResult || undefined } : h
                ));

                // Cache the audio in IndexedDB
                if (typeof generated === 'string') {
                  await audioCache.set(content, generated);
                }

                // Automatically save audio to database immediately after generation/cache retrieval
                // Start sync immediately without waiting - fire and forget
                // This ensures audio syncs to cloud right after TTS generation finishes, not after playback
                if (userId && !isDemoMode && newId && audioResult && typeof audioResult === 'string') {
              console.log(`[JournalApp] Starting immediate audio sync to database for entry ${newId}`);

              // Start optimization and save immediately (don't await - fire and forget)
              // Check existence in parallel, but start saving anyway
              Promise.all([
                historyService.checkEntryAudioExists(newId).catch(() => false),
                optimizeAudio(audioResult).catch(() => null)
              ]).then(([audioExists, optimized]) => {
                if (audioExists) {
                  console.log(`[JournalApp] Audio already exists in database for entry ${newId}`);
                  return;
                }

                // Validate optimized audio before using it
                const MIN_VALID_AUDIO_LENGTH = 1000;
                const isValidOptimized = optimized &&
                  typeof optimized === 'string' &&
                  optimized.length >= MIN_VALID_AUDIO_LENGTH;

                // Save optimized version if valid, otherwise save original
                const audioToSave = isValidOptimized ? optimized : audioResult;
                if (!isValidOptimized && optimized) {
                  console.warn(`[JournalApp] Optimized audio invalid (length: ${optimized?.length}), using original`);
                }

                historyService.saveEntryAudio(newId, audioToSave)
                  .then(() => {
                    console.log(`[JournalApp] ✅ Audio saved to database for entry ${newId}`);
                  })
                  .catch(err => {
                    console.warn('[JournalApp] Failed to save audio to database:', err);
                  });
              }).catch(err => {
                console.warn('[JournalApp] Error during audio sync setup, trying direct save:', err);
                // Fallback: try saving original directly
                historyService.saveEntryAudio(newId, audioResult)
                  .then(() => {
                    console.log(`[JournalApp] ✅ Audio saved to database (fallback) for entry ${newId}`);
                  })
                  .catch(() => { });
              });

                  // Note: We don't await - this runs in background so audio can play immediately
                }

                // Play audio automatically (since auto-play is enabled)
                playAudio(audioData, 'main');
              }
            }
          } catch (error) {
            console.error('Auto TTS generation error:', error);
            showToast('Error generating speech automatically.', 'error');
          } finally {
            setIsGeneratingVoice(false);
            setGeneratingAudioId(null);
          }
        })();
      } else {
        console.log('[JournalApp] Skipping audio generation - auto-play is disabled');
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
    }
  }, [entry, selectedMood, history]);

  const handleSendMessage = async (text: string) => {
    if (!chatSessionRef.current) {
      if (!reflection) return;
      // Always use the latest history state to ensure deleted entries are excluded
      chatSessionRef.current = await startJournalChat(entry, reflection.content, selectedMood, history, reflection.topic);
      // Clear context revalidation indicator when session is recreated
      if (contextRevalidated) {
        setContextRevalidated(false);
        showToast('Context refreshed with updated history', 'success');
      }
    }

    const newUserMsg: ChatMessage = { role: 'user', text };
    const updatedMessagesWithUser = [...chatMessages, newUserMsg];
    setChatMessages(updatedMessagesWithUser);
    updateHistoryWithChat(updatedMessagesWithUser);
    setIsSendingChat(true);

    try {
      const response = await chatSessionRef.current!.sendMessage(text);
      const modelText = response || "I'm here listening, but I couldn't find the right words just now.";
      const newModelMsg: ChatMessage = { role: 'model', text: modelText };

      const updatedMessagesWithModel = [...updatedMessagesWithUser, newModelMsg];
      setChatMessages(updatedMessagesWithModel);
      updateHistoryWithChat(updatedMessagesWithModel);

      // Only auto-generate audio for chat messages if auto-play is enabled
      if (autoPlayEnabled) {
        setIsGeneratingVoice(true);
        try {
          // Check cache first
          const cached = await audioCache.get(modelText);
          if (cached) {
            const audioData = typeof cached === 'string' ? cached : [cached];
            setChatMessages(prev => {
              const next = [...prev];
              const lastIdx = next.length - 1;
              if (next[lastIdx] && next[lastIdx].role === 'model') {
                next[lastIdx] = { ...next[lastIdx], audioBase64: audioData };
                updateHistoryWithChat(next);
              }
              return next;
            });

            const id = `chat-${updatedMessagesWithUser.length}`;
            playAudio(audioData, id);
          } else {
            // Generate with chunking
            const needsChunking = modelText.length > 1500;
            const audioResult = await generateSpeech(modelText, {
              chunked: needsChunking
            });

            if (audioResult) {
              const audioData = Array.isArray(audioResult) ? audioResult : [audioResult];
              setChatMessages(prev => {
                const next = [...prev];
                const lastIdx = next.length - 1;
                if (next[lastIdx] && next[lastIdx].role === 'model') {
                  next[lastIdx] = { ...next[lastIdx], audioBase64: audioData };
                  updateHistoryWithChat(next);
                }
                return next;
              });

              // Cache the audio
              if (typeof audioResult === 'string') {
                await audioCache.set(modelText, audioResult);
              }

              const id = `chat-${updatedMessagesWithUser.length}`;
              playAudio(audioData, id);
            } else {
              showToast('Could not generate audio automatically.', 'error');
            }
          }
        } catch (error) {
          console.error('Auto TTS generation error:', error);
          showToast('Error generating speech automatically.', 'error');
        } finally {
          setIsGeneratingVoice(false);
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

      setChatMessages(prev => [...prev, { role: 'model', text: errorMessage }]);
    } finally {
      setIsSendingChat(false);
    }
  };

  const handleStartFresh = () => {
    setShowStartNewDialog(false);
    stopCurrentAudio();
    setCurrentAudioBase64(null);
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
    chatSessionRef.current = null;
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    showToast('Started a new session', 'success');
  };

  const deleteHistoryEntry = async (id: string) => {
    // Store current history for potential rollback
    const currentHistory = history;

    // Optimistically update UI
    setHistory(prev => prev.filter(entry => entry.id !== id));

    // Also stop audio if this entry was playing
    if (activeAudioId && activeAudioId.toString().includes(id)) {
      stopCurrentAudio();
    }

    // Delete from Supabase or localStorage
    if (isDemoMode) {
      // Demo mode: update localStorage
      const updatedHistory = currentHistory.filter(e => e.id !== id);
      const historyWithoutAudio = updatedHistory.map(({ audioBase64, ...entry }) => entry);
      localStorage.setItem(currentHistoryKey, JSON.stringify(historyWithoutAudio));
    } else if (userId) {
      // Authenticated: delete from Supabase
      try {
        await historyService.deleteEntry(id);
      } catch (error) {
        console.error('Failed to delete entry from Supabase:', error);
        // Revert optimistic update on error
        setHistory(currentHistory);
        showToast('Failed to delete entry', 'error');
        return;
      }
    }

    // Check if we need to revalidate context
    const wasChatting = chatSessionRef.current !== null;
    const deletedCurrentEntry = currentHistoryId === id;

    // Invalidate chat session if it exists - context needs to be refreshed
    if (chatSessionRef.current) {
      chatSessionRef.current = null;
      // Set indicator to show context will be revalidated
      setContextRevalidated(true);
    }

    showToast('Entry deleted', 'success');
  };

  const clearAllHistory = async () => {
    // Stop any playing audio
    if (isPlayingAudio) {
      stopCurrentAudio();
    }

    // Optimistically clear history
    setHistory([]);

    // Clear from Supabase or localStorage
    if (isDemoMode) {
      // Demo mode: clear localStorage
      localStorage.removeItem(currentHistoryKey);
    } else if (userId) {
      // Authenticated: clear from Supabase
      try {
        await historyService.deleteAllEntries();

        // IMPORTANT: Also clear localStorage to prevent migration logic from re-importing old data
        // The migration logic (lines 331-338) checks if DB is empty and localStorage has data,
        // and automatically migrates localStorage → DB. This would undo the clear!
        localStorage.removeItem(LEGACY_HISTORY_KEY); // Clear legacy key
        localStorage.removeItem(`serenity_journal_history_${userId}`); // Clear user-specific key
        localStorage.removeItem(currentHistoryKey); // Clear current key (should be same as above)
        console.log('[JournalApp] Cleared database and localStorage to prevent migration re-import');
      } catch (error) {
        console.error('Failed to clear history from Supabase:', error);
        showToast('Failed to clear history', 'error');
        // Try to reload history on error (only first page)
        try {
          const historyResult = await historyService.fetchHistory({ limit: 5, offset: 0 });
          const loadedHistory = Array.isArray(historyResult)
            ? historyResult
            : historyResult.entries || [];
          setHistory(loadedHistory);
        } catch (e) {
          // Ignore reload errors
        }
        return;
      }
    }

    // Invalidate chat session if it exists
    if (chatSessionRef.current) {
      chatSessionRef.current = null;
      setContextRevalidated(true);
    }

    // Reset current history ID if it was set
    if (currentHistoryId) {
      setCurrentHistoryId(null);
    }

    showToast('All history cleared', 'success');
  };

  const isButtonDisabled = !entry.trim() || status === AppStatus.LOADING;
  const wordCount = entry.trim() ? entry.trim().split(/\s+/).length : 0;

  const handleExitDemo = () => {
    // Clear demo data from localStorage
    localStorage.removeItem('serenity_journal_history_demo');
    localStorage.removeItem('serenity_journal_autoplay_demo');

    // Clear demo cookie
    document.cookie = 'demo-mode=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
    window.location.href = '/login';
  };


  return (
    <div className="min-h-screen px-4 md:px-6 py-6 md:py-20 max-w-2xl mx-auto flex flex-col">
      <ToastContainer />

      {isDemoMode && (
        <div className="mb-4 md:mb-6 p-3 md:p-4 bg-amber-50/50 border border-amber-200/50 rounded-lg flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 md:gap-4">
          <div className="flex items-start gap-2.5 md:gap-3 flex-1 min-w-0">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 md:h-5 md:w-5 text-amber-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div className="flex-1 min-w-0">
              <p className="text-xs md:text-sm font-medium text-amber-900 mb-0.5">Demo Mode</p>
              <p className="text-[10px] md:text-xs text-amber-700 font-light leading-relaxed">Your entries won't be saved. <button onClick={() => window.location.href = '/login'} className="underline hover:text-amber-900">Sign in</button></p>
            </div>
          </div>
          <button
            onClick={handleExitDemo}
            className="text-[10px] md:text-xs text-amber-700 hover:text-amber-900 font-medium px-3 py-1.5 md:py-1 rounded-full hover:bg-amber-100 transition-colors flex-shrink-0 touch-manipulation"
          >
            Exit Demo
          </button>
        </div>
      )}

      <header className="mb-6 md:mb-12 text-center md:text-left flex flex-col md:flex-row md:items-end md:justify-between border-b border-stone-100 pb-4 md:pb-8">
        <div>
          <h1 className="text-xl md:text-4xl font-light text-stone-800 tracking-tight font-serif mb-0.5 md:mb-2">
            Serenity Journal
          </h1>
          <p className="text-stone-500 text-[10px] md:text-base font-light">
            A quiet space for your thoughts.
          </p>
        </div>

        <div className="flex flex-col items-center md:items-end mt-4 md:mt-0 gap-2 md:gap-3">
          <div className="flex flex-wrap justify-center md:justify-end items-center gap-2 md:gap-4">
            {(isPlayingAudio || isGeneratingVoice) && (
              <span className="flex items-center gap-1.5 text-[9px] md:text-[10px] text-emerald-600 bg-emerald-50 px-2 py-0.5 md:py-1 rounded-full uppercase tracking-widest font-bold border border-emerald-100">
                {isGeneratingVoice ? (
                  <svg className="animate-spin h-2.5 w-2.5 md:h-3 md:w-3 text-emerald-500" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                ) : (
                  <span className="flex gap-0.5">
                    <span className="w-0.5 h-1.5 md:h-2 bg-emerald-500 animate-[bounce_0.6s_infinite]"></span>
                    <span className="w-0.5 h-2 md:h-3 bg-emerald-500 animate-[bounce_0.8s_infinite]"></span>
                  </span>
                )}
                {isGeneratingVoice ? 'Wait' : 'Speaking'}
              </span>
            )}
            {history.length > 0 && viewMode === ViewMode.JOURNAL && (
              <span className="flex items-center gap-1.5 text-[9px] md:text-[10px] text-emerald-600 bg-emerald-50 px-2 py-0.5 md:py-1 rounded-full uppercase tracking-widest font-bold border border-emerald-100 animate-pulse">
                <span className="w-1 md:w-1.5 h-1 md:h-1.5 bg-emerald-500 rounded-full"></span>
                Active
              </span>
            )}
            {isAudioSyncing && audioSyncProgress && (
              <span className="flex items-center gap-1.5 text-[9px] md:text-[10px] text-emerald-600 bg-emerald-50 px-2 py-0.5 md:py-1 rounded-full uppercase tracking-widest font-bold border border-emerald-100">
                <svg className="animate-spin h-2.5 w-2.5 md:h-3 md:w-3 text-emerald-500" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Syncing
              </span>
            )}
            {/* DEBUG: Show auto-play status */}
            <span className={`flex items-center gap-1.5 text-[9px] md:text-[10px] px-2 py-0.5 md:py-1 rounded-full uppercase tracking-widest font-bold border ${autoPlayEnabled
              ? 'text-emerald-600 bg-emerald-50 border-emerald-100'
              : 'text-stone-400 bg-stone-50 border-stone-200'
              }`}>
              Auto-play: {autoPlayEnabled ? 'ON' : 'OFF'}
            </span>
          </div>

          <div className="flex items-center gap-2 md:gap-3">
            <button
              onClick={() => setViewMode(viewMode === ViewMode.JOURNAL ? ViewMode.HISTORY : ViewMode.JOURNAL)}
              className="flex items-center gap-1.5 text-stone-500 hover:text-emerald-700 text-xs md:text-sm transition-colors px-3 py-2 md:py-1 rounded-full hover:bg-emerald-50 touch-manipulation min-h-[44px] md:min-h-0"
            >
              {viewMode === ViewMode.JOURNAL ? (
                <><svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg> History</>
              ) : (
                <><svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg> Journal</>
              )}
            </button>

            {(session?.user || isDemoMode) && (
              <div className="flex items-center gap-2">
                {session?.user && (
                  <span className="text-stone-400 text-xs hidden md:inline">
                    {session.user.email?.split('@')[0]}
                  </span>
                )}
                {session?.user ? (
                  <button
                    onClick={() => {
                      // Clear user's localStorage data before signing out
                      if (userId) {
                        localStorage.removeItem(`serenity_journal_history_${userId}`);
                        localStorage.removeItem(`serenity_journal_autoplay_${userId}`);
                      }
                      signOut({ callbackUrl: '/login' });
                    }}
                    className="flex items-center gap-1.5 text-stone-400 hover:text-stone-600 text-xs md:text-sm transition-colors px-3 py-2 md:py-1 rounded-full hover:bg-stone-50 touch-manipulation min-h-[44px] md:min-h-0"
                    title="Sign out"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                    </svg>
                    <span className="hidden md:inline">Sign out</span>
                  </button>
                ) : isDemoMode && (
                  <button
                    onClick={() => window.location.href = '/login'}
                    className="flex items-center gap-1.5 text-emerald-600 hover:text-emerald-700 text-xs md:text-sm transition-colors px-3 py-2 md:py-1 rounded-full hover:bg-emerald-50 font-medium touch-manipulation min-h-[44px] md:min-h-0"
                    title="Sign in to save your entries"
                  >
                    Sign in
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="flex-grow flex flex-col">
        {viewMode === ViewMode.JOURNAL ? (
          <div key={sessionKey} className="relative flex-grow flex flex-col animate-in fade-in duration-500">
            <div className="relative flex flex-col flex-grow">
              <textarea
                ref={textareaRef}
                value={entry}
                onChange={handleEntryChange}
                onKeyDown={(e) => {
                  // Trigger reflection with Ctrl+Enter (Windows/Linux) or Cmd+Enter (Mac)
                  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                    e.preventDefault();
                    if (entry.trim() && status !== AppStatus.LOADING) {
                      handleGetReflection();
                    }
                  }
                }}
                placeholder="How are you feeling right now?"
                className="w-full min-h-[200px] md:min-h-[350px] bg-transparent text-base md:text-2xl font-light text-stone-800 placeholder-stone-300 border-none outline-none focus:ring-0 focus:outline-none resize-none p-0 leading-[1.6] mb-3 md:mb-4 transition-all duration-300 overflow-hidden"
                disabled={status === AppStatus.LOADING}
                autoFocus
              />

              {entry.length > 0 && (
                <div className="flex justify-end">
                  <span className="text-[9px] md:text-[10px] text-stone-400 uppercase tracking-widest font-bold">
                    {wordCount} {wordCount === 1 ? 'word' : 'words'}
                  </span>
                </div>
              )}
            </div>

            <div className="sticky bottom-0 md:bottom-8 py-3 md:py-6 pt-4 pb-safe bg-gradient-to-t from-[#FDFCF8] via-[#FDFCF8] to-transparent flex flex-col md:flex-row gap-3 md:gap-4 z-10">
              <button
                onClick={handleGetReflection}
                disabled={isButtonDisabled && status !== AppStatus.LOADING}
                className={`
                  group relative flex-grow md:flex-initial px-6 md:px-10 py-3.5 md:py-4 rounded-full font-medium transition-all duration-300 active:scale-95 touch-manipulation min-h-[48px] md:min-h-0
                  ${status === AppStatus.LOADING
                    ? '!bg-emerald-900 md:!bg-emerald-800 !text-white md:!text-emerald-50 border-2 border-emerald-800 md:border-0 shadow-lg md:shadow-md cursor-wait'
                    : isButtonDisabled
                      ? 'bg-stone-100 text-stone-300 cursor-not-allowed opacity-50'
                      : '!bg-emerald-900 md:!bg-emerald-800 !text-white md:!text-emerald-50 border-2 border-emerald-800 md:border-0 hover:bg-emerald-950 md:hover:bg-emerald-900 shadow-lg md:shadow-md hover:shadow-xl md:hover:shadow-lg'}
                `}
                style={status === AppStatus.LOADING ? { backgroundColor: '#064e3b', color: '#ffffff' } : !isButtonDisabled ? { backgroundColor: '#064e3b' } : undefined}
              >
                <span className={`flex items-center justify-center gap-2 text-sm md:text-base ${status === AppStatus.LOADING ? '!text-white' : ''}`} style={status === AppStatus.LOADING ? { color: '#ffffff' } : undefined}>
                  {status === AppStatus.LOADING ? (
                    <>
                      {/* Mobile: Show detailed progress stage */}
                      <div className="md:hidden flex items-center gap-2">
                        {!reflectionProgress ? (
                          <svg className="animate-spin h-4 w-4 !text-white" viewBox="0 0 24 24" style={{ color: '#ffffff' }}>
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                        ) : reflectionProgress.stage === 'extracting_entities' ? (
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 !text-white animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ color: '#ffffff' }}>
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                          </svg>
                        ) : reflectionProgress.stage === 'detecting_mood' ? (
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 !text-white animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ color: '#ffffff' }}>
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        ) : reflectionProgress.stage === 'detecting_topic' ? (
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 !text-white animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ color: '#ffffff' }}>
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                          </svg>
                        ) : reflectionProgress.stage === 'building_context' ? (
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 !text-white animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ color: '#ffffff' }}>
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                        ) : reflectionProgress.stage === 'generating_reflection' ? (
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 !text-white animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ color: '#ffffff' }}>
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                          </svg>
                        ) : (
                          <svg className="animate-spin h-4 w-4 !text-white" viewBox="0 0 24 24" style={{ color: '#ffffff' }}>
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                        )}
                        <span className="!text-white font-semibold" style={{ color: '#ffffff' }}>{reflectionProgress?.message || 'Reflecting...'}</span>
                      </div>

                      {/* Desktop: Simple spinner */}
                      <div className="hidden md:flex items-center gap-2">
                        <svg className="animate-spin h-5 w-5 text-stone-300" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        <span>Reflecting...</span>
                      </div>
                    </>
                  ) : (
                    <>Get Reflection <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 md:h-5 md:w-5 transition-transform group-hover:translate-x-1" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M12.293 5.293a1 1 0 011.414 0l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-2.293-2.293a1 1 0 010-1.414z" clipRule="evenodd" /></svg></>
                  )}
                </span>
              </button>

              {/* AI Progress Indicator - Desktop Only */}
              {reflectionProgress && status === AppStatus.LOADING && (
                <div className="hidden md:flex items-center gap-2 md:gap-3 px-4 md:px-6 py-2 md:py-3 bg-emerald-50/50 border border-emerald-100 rounded-full animate-in fade-in duration-300">
                  {/* Animated Icon */}
                  {reflectionProgress.stage === 'extracting_entities' && (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 md:h-4 md:w-4 text-emerald-600 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  )}
                  {reflectionProgress.stage === 'detecting_mood' && (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 md:h-4 md:w-4 text-emerald-600 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  )}
                  {reflectionProgress.stage === 'detecting_topic' && (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 md:h-4 md:w-4 text-emerald-600 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                    </svg>
                  )}
                  {reflectionProgress.stage === 'building_context' && (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 md:h-4 md:w-4 text-emerald-600 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  )}
                  {reflectionProgress.stage === 'generating_reflection' && (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 md:h-4 md:w-4 text-emerald-600 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                    </svg>
                  )}

                  {/* Progress Text */}
                  <span className="text-[9px] md:text-[10px] text-emerald-700 font-medium uppercase tracking-widest">
                    {reflectionProgress.message}
                  </span>

                  {/* Animated Dots */}
                  <div className="flex gap-0.5 ml-1">
                    <span className="w-0.5 md:w-1 h-0.5 md:h-1 bg-emerald-400 rounded-full animate-bounce"></span>
                    <span className="w-0.5 md:w-1 h-0.5 md:h-1 bg-emerald-400 rounded-full animate-bounce [animation-delay:0.2s]"></span>
                    <span className="w-0.5 md:w-1 h-0.5 md:h-1 bg-emerald-400 rounded-full animate-bounce [animation-delay:0.4s]"></span>
                  </div>
                </div>
              )}

              {isMounted ? (
                <AlertDialog.Root open={showStartNewDialog} onOpenChange={setShowStartNewDialog}>
                  <AlertDialog.Trigger asChild>
                    <button
                      className="px-4 md:px-6 py-3 md:py-4 rounded-full text-stone-400 hover:text-stone-600 hover:bg-stone-100 transition-all text-xs md:text-sm font-medium touch-manipulation min-h-[48px] md:min-h-0"
                    >
                      Start New
                    </button>
                  </AlertDialog.Trigger>
                  <AlertDialog.Portal>
                    <AlertDialog.Overlay className="fixed inset-0 bg-black/20 backdrop-blur-sm z-50 animate-in fade-in" />
                    <AlertDialog.Content className="fixed top-1/2 left-1/2 bg-white rounded-2xl shadow-2xl border border-stone-200 p-6 md:p-8 max-w-md w-[90vw] z-50 animate-in fade-in zoom-in-95 duration-200">
                      <AlertDialog.Title className="text-xl md:text-2xl font-semibold text-stone-900 mb-2 font-serif">
                        Start New Session?
                      </AlertDialog.Title>
                      <AlertDialog.Description className="text-stone-600 mb-6 text-sm md:text-base leading-relaxed">
                        This will clear your current writing and reflection. Your previous entries will be saved in history.
                      </AlertDialog.Description>
                      <div className="flex gap-3 justify-end">
                        <AlertDialog.Cancel asChild>
                          <button className="px-4 py-2 rounded-full text-stone-600 hover:bg-stone-100 transition-colors text-sm font-medium">
                            Cancel
                          </button>
                        </AlertDialog.Cancel>
                        <AlertDialog.Action asChild>
                          <button
                            onClick={handleStartFresh}
                            className="px-4 py-2 rounded-full bg-emerald-600 text-white hover:bg-emerald-700 transition-colors text-sm font-medium"
                          >
                            Start New
                          </button>
                        </AlertDialog.Action>
                      </div>
                    </AlertDialog.Content>
                  </AlertDialog.Portal>
                </AlertDialog.Root>
              ) : (
                <button
                  onClick={() => setShowStartNewDialog(true)}
                  className="px-6 py-2 md:py-4 rounded-full text-stone-400 hover:text-stone-600 hover:bg-stone-100 transition-all text-xs md:text-sm font-medium"
                >
                  Start New
                </button>
              )}
            </div>

            {error && <p className="mt-4 text-rose-500 text-xs md:text-sm text-center md:text-left font-medium">{error}</p>}

            <ReflectionCard
              reflection={reflection}
              isLoading={status === AppStatus.LOADING}
              onPlay={handleTogglePlayback}
              onPause={pauseCurrentAudio}
              onStop={stopCurrentAudio}
              isPlaying={isPlayingAudio && activeAudioId === 'main'}
              isPaused={isPaused && activeAudioId === 'main'}
              isGeneratingVoice={isGeneratingVoice && generatingAudioId === 'main'}
              playbackRate={playbackRate}
              onPlaybackRateChange={setPlaybackSpeed}
            />

            {/* Token Usage Display */}
            {currentTokenUsage && status === AppStatus.SUCCESS && (
              <div className="mt-4 px-4 md:px-6 py-3 bg-stone-50/50 border border-stone-100 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-semibold text-stone-600 uppercase tracking-wide">Token Usage</h3>
                  {cumulativeTokenUsage.requestCount > 1 && (
                    <span className="text-xs text-stone-400">
                      {cumulativeTokenUsage.requestCount} requests
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                  <div>
                    <div className="text-stone-400 mb-0.5">Input</div>
                    <div className="font-medium text-stone-700">
                      {currentTokenUsage.promptTokens.toLocaleString()}
                      {currentTokenUsage.cachedTokens && currentTokenUsage.cachedTokens > 0 && (
                        <span className="text-emerald-600 ml-1" title="Cached tokens (cost savings)">
                          ({currentTokenUsage.cachedTokens.toLocaleString()} cached)
                        </span>
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="text-stone-400 mb-0.5">Output</div>
                    <div className="font-medium text-stone-700">
                      {currentTokenUsage.completionTokens.toLocaleString()}
                    </div>
                  </div>
                  <div>
                    <div className="text-stone-400 mb-0.5">Total</div>
                    <div className="font-medium text-stone-700">
                      {currentTokenUsage.totalTokens.toLocaleString()}
                    </div>
                  </div>
                  {cumulativeTokenUsage.requestCount > 1 && (
                    <div>
                      <div className="text-stone-400 mb-0.5">Session Total</div>
                      <div className="font-medium text-stone-700">
                        {cumulativeTokenUsage.totalTokens.toLocaleString()}
                      </div>
                    </div>
                  )}
                </div>
                {currentTokenUsage.cachedTokens && currentTokenUsage.cachedTokens > 0 && (
                  <div className="mt-2 pt-2 border-t border-stone-100">
                    <div className="flex items-center gap-1.5 text-xs text-emerald-600">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      <span>
                        {currentTokenUsage.cachedTokens.toLocaleString()} tokens served from cache (reduced cost)
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {status === AppStatus.SUCCESS && reflection && (
              <div className="mt-6 md:mt-8 flex justify-center md:justify-start">
                <button
                  onClick={() => setIsChatting(true)}
                  className="text-emerald-700 hover:text-emerald-800 text-xs md:text-sm font-medium flex items-center gap-2 px-6 py-3 rounded-full bg-emerald-50/50 hover:bg-emerald-50 transition-all border border-emerald-100/50 group"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 transition-transform group-hover:scale-110" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                  Ask a follow-up
                </button>
              </div>
            )}

            {isChatting && (
              <ChatInterface
                messages={chatMessages}
                contextRevalidated={contextRevalidated}
                onSendMessage={handleSendMessage}
                isSending={isSendingChat}
                onClose={() => setIsChatting(false)}
                onTogglePlayback={handleToggleChatPlayback}
                activeAudioId={activeAudioId}
                generatingAudioId={generatingAudioId}
              />
            )}
          </div>
        ) : (
          <HistoryView
            history={history}
            onBack={() => setViewMode(ViewMode.JOURNAL)}
            onDeleteEntry={deleteHistoryEntry}
            onClearAll={clearAllHistory}
            onPlayAudio={handleHistoryAudioPlayback}
            onPauseAudio={pauseCurrentAudio}
            onStopAudio={stopCurrentAudio}
            activeAudioId={activeAudioId}
            isPlaying={isPlayingAudio}
            isPaused={isPaused}
            isGeneratingVoice={isGeneratingVoice}
            generatingAudioId={generatingAudioId}
          />
        )}
      </main>

      <footer className="mt-12 md:mt-16 py-6 md:py-8 border-t border-stone-100 flex flex-col md:flex-row justify-between items-center text-stone-400 text-[10px] md:text-xs tracking-widest uppercase gap-4">
        <div className="text-center md:text-left leading-relaxed">
          Your thoughts are private and safe. <br />
          <span className="opacity-60 lowercase font-normal italic">A companion, not professional care.</span>
        </div>
        <div className="flex gap-6">
          <button className={`transition-colors ${viewMode === ViewMode.HISTORY ? 'text-emerald-700 font-bold' : 'hover:text-stone-600'}`} onClick={() => setViewMode(ViewMode.HISTORY)}>History</button>
          <button
            className="hover:text-stone-600 transition-colors flex items-center gap-1"
            onClick={() => {
              const newValue = !autoPlayEnabled;
              console.log(`[JournalApp] Toggling auto-play from ${autoPlayEnabled} to ${newValue}`);
              setAutoPlayEnabled(newValue);
              showToast(`Auto-play ${newValue ? 'enabled' : 'disabled'}`, 'success');
            }}
            title={autoPlayEnabled ? 'Disable auto-play' : 'Enable auto-play'}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className={`h-3 w-3 ${autoPlayEnabled ? 'text-emerald-600' : 'text-stone-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              {autoPlayEnabled ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              )}
            </svg>
            <span>Auto-play</span>
          </button>
        </div>
      </footer>
    </div>
  );
};

export default JournalApp;
