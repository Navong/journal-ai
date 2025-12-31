'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Reflection, AppStatus, ViewMode, HistoryEntry, Mood, ChatMessage, AudioPlaybackState } from '../types';
import { getJournalReflection, startJournalChat, generateSpeech } from '../services/geminiService';
import { ReflectionCard } from './ReflectionCard';
import { HistoryView } from './HistoryView';
import { ChatInterface } from './ChatInterface';
import { Chat } from '@google/genai';
import { audioCache } from '../utils/audioCache';
import { showToast, ToastContainer } from '../utils/toast';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { useSession, signOut } from 'next-auth/react';
import { historyService } from '../services/historyService';
import { optimizeAudio } from '../utils/audioOptimizer';
import { syncAudioToDatabase, getSyncStats, shouldRunSync, getSyncState, AudioSyncProgress, SYNC_INTERVAL } from '../utils/audioSync';

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

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number = 24000,
  numChannels: number = 1,
): Promise<AudioBuffer> {
  // Int16Array requires buffer length to be a multiple of 2 (16 bits = 2 bytes per sample)
  // Ensure we have an even number of bytes
  const dataLength = data.length;
  const alignedLength = Math.floor(dataLength / 2) * 2; // Round down to even number

  if (alignedLength === 0) {
    throw new Error('Audio data is too short');
  }

  // Create a properly aligned buffer - use byte offset and length from the original buffer
  // Or create a new Uint8Array with only the aligned portion
  let alignedData: Uint8Array;
  if (alignedLength === dataLength) {
    // Already aligned, use the buffer directly
    alignedData = data;
  } else {
    // Trim to even length
    alignedData = data.slice(0, alignedLength);
    console.warn(`[decodeAudioData] Trimmed ${dataLength - alignedLength} byte(s) to align buffer`);
  }

  // Create Int16Array with the aligned buffer
  // Use byteOffset and byteLength to ensure proper alignment
  const dataInt16 = new Int16Array(alignedData.buffer, alignedData.byteOffset, alignedLength / 2);
  const frameCount = dataInt16.length / numChannels;

  if (frameCount === 0) {
    throw new Error('No audio frames found after alignment');
  }

  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
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
  const [autoPlayEnabled, setAutoPlayEnabled] = useState<boolean>(true); // Default to true, will hydrate from localStorage

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
  const chatSessionRef = useRef<Chat | null>(null);
  const [isSendingChat, setIsSendingChat] = useState(false);
  const [contextRevalidated, setContextRevalidated] = useState(false);

  const entryRef = useRef(entry);

  // Get current user ID or demo identifier
  const userId = session?.user?.id || null;
  const currentHistoryKey = getHistoryKey(userId, isDemoMode);
  const currentAutoPlayKey = getAutoPlayKey(userId, isDemoMode);
  const prevUserIdRef = useRef<string | null>(null);
  const prevDemoModeRef = useRef<boolean>(false);

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
            }
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
              const [loadedHistory, preferences] = await Promise.all([
                historyService.fetchHistory(),
                historyService.getPreferences(),
              ]);

              console.log(`[JournalApp] Received ${loadedHistory?.length || 0} entries and preferences:`, preferences);

              // Final check before setting state
              if (prevUserIdRef.current !== currentUserId && !isInitialHydration) {
                console.log('[JournalApp] User changed during API call, aborting state update');
                return; // User changed during API call, don't set stale data
              }

              console.log(`[JournalApp] ✅ Setting history with ${loadedHistory?.length || 0} entries`);
              setHistory(loadedHistory || []);

              if (preferences) {
                setAutoPlayEnabled(preferences.auto_play_enabled);
                console.log(`[JournalApp] ✅ Set autoPlayEnabled to ${preferences.auto_play_enabled}`);
              }

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
            }
          } else if (authStatus === 'authenticated' && session && !currentUserId && !isDemoMode) {
            // Session exists but no userId - might be loading or userId not set
            console.log('[JournalApp] Session authenticated but userId is null, waiting for session update...');
            // Don't set empty history yet, let it retry when userId becomes available
            return;
          } else {
            // No session and not demo mode
            setHistory([]);
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
        const result = await syncAudioToDatabase((progress) => {
          setAudioSyncProgress(progress);
          // Log progress but don't show toast (background operation)
          if (progress.isComplete) {
            console.log(`[JournalApp] Audio sync complete: ${progress.saved} file(s) synced, ${progress.errors} error(s)`);
          }
        });

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

    if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
      audioContextRef.current.resume().then(() => {
        if (shouldContinuePlayingRef.current) { // Check again after async operation
          setIsPaused(false);
        }
      }).catch(console.error);
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

      // On mobile, AudioContext often starts in 'suspended' state and must be resumed
      // This is a security feature - audio can only play after user interaction
      if (ctx.state === 'suspended') {
        console.log('[playAudioChunk] AudioContext suspended, attempting to resume...');
        try {
          await ctx.resume();
          console.log('[playAudioChunk] AudioContext resumed, new state:', ctx.state);

          // Double-check - sometimes resume() doesn't work immediately on mobile
          if (ctx.state === 'suspended') {
            console.log('[playAudioChunk] Still suspended after resume, waiting...');
            await new Promise(resolve => setTimeout(resolve, 100));
            if (ctx.state === 'suspended') {
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
      // Final check before proceeding
      if (ctx.state === 'suspended') {
        console.log('[playAudioChunk] Final resume attempt...');
        await ctx.resume();
      }

      if (ctx.state !== 'running') {
        const errorMsg = `AudioContext is ${ctx.state}. Audio playback requires user interaction. Please tap the play button again.`;
        console.error('[playAudioChunk]', errorMsg);
        showToast('Audio requires interaction. Please tap play again.', 'error');
        throw new Error(errorMsg);
      }

      console.log('[playAudioChunk] AudioContext ready, state:', ctx.state);

      let buffer: AudioBuffer;

      // Check if audio is compressed (from database) or raw PCM (from cache)
      const isCompressed = isCompressedAudio(base64Audio);
      console.log(`[playAudioChunk] Audio format detected: ${isCompressed ? 'compressed' : 'raw PCM'}, length: ${base64Audio.length}`);

      if (isCompressed) {
        // Compressed audio: decode using AudioContext.decodeAudioData
        try {
          const audioBytes = decodeBase64(base64Audio);
          const mimeType = getAudioMimeType(base64Audio);
          console.log(`[playAudioChunk] Decoding compressed audio as ${mimeType}`);
          const audioBlob = new Blob([audioBytes], { type: mimeType });
          const arrayBuffer = await audioBlob.arrayBuffer();
          buffer = await ctx.decodeAudioData(arrayBuffer);
          console.log(`[playAudioChunk] Successfully decoded compressed audio: ${buffer.duration.toFixed(2)}s, ${buffer.sampleRate}Hz`);
        } catch (decodeError) {
          console.error('[playAudioChunk] Failed to decode compressed audio, trying PCM fallback:', decodeError);
          // Fallback to PCM decoding if compressed decode fails
          try {
            const audioBytes = decodeBase64(base64Audio);
            buffer = await decodeAudioData(audioBytes, ctx);
            console.log(`[playAudioChunk] Successfully decoded as PCM fallback: ${buffer.duration.toFixed(2)}s`);
          } catch (pcmError) {
            console.error('[playAudioChunk] Both compressed and PCM decoding failed:', pcmError);
            throw new Error('Failed to decode audio in any format');
          }
        }
      } else {
        // Raw PCM: use existing decoder
        try {
          const audioBytes = decodeBase64(base64Audio);
          buffer = await decodeAudioData(audioBytes, ctx);
          console.log(`[playAudioChunk] Successfully decoded PCM audio: ${buffer.duration.toFixed(2)}s, ${buffer.sampleRate}Hz`);
        } catch (pcmError) {
          console.error('[playAudioChunk] Failed to decode PCM audio:', pcmError);
          // Try as compressed audio as fallback
          try {
            console.log('[playAudioChunk] Trying compressed audio fallback...');
            const audioBytes = decodeBase64(base64Audio);
            const audioBlob = new Blob([audioBytes], { type: 'audio/webm' });
            const arrayBuffer = await audioBlob.arrayBuffer();
            buffer = await ctx.decodeAudioData(arrayBuffer);
            console.log(`[playAudioChunk] Successfully decoded as compressed fallback: ${buffer.duration.toFixed(2)}s`);
          } catch (compressedError) {
            console.error('[playAudioChunk] Both PCM and compressed decoding failed:', compressedError);
            throw new Error('Failed to decode audio in any format');
          }
        }
      }

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = playbackRate;

      const gainNode = ctx.createGain();
      source.connect(gainNode);
      gainNode.connect(ctx.destination);

      return new Promise<void>((resolve) => {
        // Track playback start time to ensure full duration plays
        // The onended event can fire 1-2 seconds early with compressed audio from database
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

          // The onended event often fires early (especially with compressed audio from DB)
          // Wait for the full expected duration plus a small safety buffer
          const waitTime = Math.max(0, remainingTime) + 150; // Add 150ms safety buffer

          console.log(`[playAudioChunk] onended fired after ${timeElapsed.toFixed(0)}ms, expected ${timingInfo.expectedDurationMs.toFixed(0)}ms, waiting ${waitTime.toFixed(0)}ms more`);

          setTimeout(() => {
            // Only call onComplete if playback should continue
            if (shouldContinuePlayingRef.current && currentPlaybackIdRef.current === id) {
              if (onComplete) {
                onComplete();
              }
            }
            resolve();
          }, Math.min(waitTime, 2500)); // Cap at 2.5 seconds max delay
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

        // Double-check context is running before starting (mobile requirement)
        // Use .then() since we're inside a Promise executor (can't use await)
        const ensureContextRunning = async () => {
          let currentState = ctx.state;
          if (currentState !== 'running') {
            console.log('[playAudioChunk] Context not running before start, attempting to resume...');
            await ctx.resume();
            // Store state after resume to avoid TypeScript type narrowing issues
            currentState = ctx.state;
            if (currentState !== 'running') {
              throw new Error(`AudioContext is ${currentState}, cannot start playback`);
            }
          }
        };

        ensureContextRunning()
          .then(() => {
            try {
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
    audioData: string | string[],
    id: string | number = 'main'
  ) => {
    stopCurrentAudio();

    const chunks = Array.isArray(audioData) ? audioData : [audioData];

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
    // Ensure AudioContext is created/resumed on user interaction (required for mobile)
    ensureAudioContext();

    if (isPlayingAudio && activeAudioId === 'main') {
      if (isPaused) {
        resumeCurrentAudio();
      } else {
        pauseCurrentAudio();
      }
    } else if (isPaused && activeAudioId === 'main') {
      resumeCurrentAudio();
    } else {
      if (currentAudioBase64 && (activeAudioId !== 'main' || !isPlayingAudio)) {
        const audioData = typeof currentAudioBase64 === 'string'
          ? currentAudioBase64
          : Array.isArray(currentAudioBase64)
            ? currentAudioBase64
            : [currentAudioBase64];
        playAudio(audioData, 'main');
      } else if (reflection) {
        setIsGeneratingVoice(true);
        setGeneratingAudioId('main');
        try {
          // Check cache first
          const cached = await audioCache.get(reflection.content);
          if (cached) {
            const audioData = typeof cached === 'string' ? cached : [cached];
            setCurrentAudioBase64(audioData);
            playAudio(audioData, 'main');
          } else {
            // Generate with chunking for long texts
            const textLength = reflection.content.length;
            const needsChunking = textLength > 1500;

            const audioResult = await generateSpeech(reflection.content, {
              chunked: needsChunking
            });

            if (audioResult) {
              const audioData = Array.isArray(audioResult) ? audioResult : [audioResult];
              setCurrentAudioBase64(audioData);

              // Cache the audio
              if (typeof audioResult === 'string') {
                await audioCache.set(reflection.content, audioResult);

                // Automatically save to database when audio is first generated
                if (userId && !isDemoMode && currentHistoryId) {
                  optimizeAudio(audioResult)
                    .then(optimized => {
                      historyService.saveEntryAudio(currentHistoryId, optimized).catch(err => {
                        console.warn('[JournalApp] Failed to save optimized audio:', err);
                      });
                    })
                    .catch(err => {
                      console.warn('[JournalApp] Audio optimization failed, saving original:', err);
                      if (audioResult) {
                        historyService.saveEntryAudio(currentHistoryId, audioResult).catch(() => { });
                      }
                    });
                }
              }

              // Audio is stored in IndexedDB, no need to store in history state
              // This avoids localStorage quota issues

              playAudio(audioData, 'main');
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
      let audioData: string | string[] | null = null;

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

      // Fetch audio from database on-demand (cross-device sync)
      // Only fetch if we have a valid entry ID and user is authenticated
      if (entryId && userId && !isDemoMode) {
        console.log(`[handleHistoryAudioPlayback] Fetching audio from database for entry ${entryId}...`);
        const dbAudio = await historyService.fetchEntryAudio(entryId);
        if (dbAudio) {
          audioData = dbAudio;
          // Cache locally for faster future access
          await audioCache.set(text, dbAudio);
          setIsGeneratingVoice(false);
          setGeneratingAudioId(null);
          playAudio(audioData, id);
          return;
        }
      }

      // Generate new audio
      const needsChunking = text.length > 1500;
      const audioResult = await generateSpeech(text, {
        chunked: needsChunking
      });

      if (audioResult) {
        audioData = Array.isArray(audioResult) ? audioResult : [audioResult];

        // Cache locally
        if (typeof audioResult === 'string') {
          await audioCache.set(text, audioResult);

          // Optimize and sync to database for cross-device access
          if (userId && !isDemoMode && historyEntry?.id) {
            optimizeAudio(audioResult)
              .then(optimized => {
                historyService.saveEntryAudio(historyEntry.id, optimized).catch(err => {
                  console.warn('[JournalApp] Failed to save optimized audio:', err);
                });
              })
              .catch(err => {
                console.warn('[JournalApp] Audio optimization failed, saving original:', err);
                if (audioResult) {
                  historyService.saveEntryAudio(historyEntry.id, audioResult).catch(() => { });
                }
              });
          }
        }

        playAudio(audioData, id);
      } else {
        showToast('Could not generate audio. Please try again.', 'error');
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
          // Generate with chunking for long texts
          const needsChunking = text.length > 1500;
          const audioResult = await generateSpeech(text, {
            chunked: needsChunking
          });

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
    stopCurrentAudio();

    try {
      // Clear context revalidation indicator when new reflection is generated
      if (contextRevalidated) {
        setContextRevalidated(false);
      }

      const { reflection: content, summary, topic } = await getJournalReflection(entry, selectedMood, history);
      console.log(`[JournalApp] Received reflection with topic: "${topic}"`);
      const newReflection = {
        content,
        summary,
        timestamp: new Date(),
        topic
      };

      const newId = crypto.randomUUID();
      setCurrentHistoryId(newId);
      setReflection(newReflection);
      setStatus(AppStatus.SUCCESS);

      const newHistoryEntry: HistoryEntry = {
        id: newId,
        text: entry,
        summary: summary,
        reflection: content,
        mood: selectedMood,
        topic: topic,
        timestamp: new Date().toISOString(),
        chatHistory: []
      };
      console.log(`[JournalApp] Created history entry with topic: "${topic}"`);

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

      // Auto-generate audio (and save to DB) whether auto-play is enabled or not
      // This ensures audio is always generated and synced to cloud
      setIsGeneratingVoice(true);
      setGeneratingAudioId('main');

      // Always generate and save audio to database after "Get Reflection"
      // This ensures both text and audio sync to cloud immediately
      // Audio will play automatically only if auto-play is enabled
      (async () => {
        try {
          // Check cache first
          const cached = await audioCache.get(content);
          let audioResult: string | null = null;

          if (cached) {
            // Use cached audio
            audioResult = typeof cached === 'string' ? cached : cached[0];
            const audioData = typeof cached === 'string' ? [cached] : cached;
            setCurrentAudioBase64(audioData);

            // Store cached audio with history entry
            setHistory(prev => prev.map(h =>
              h.id === newId ? { ...h, audioBase64: cached } : h
            ));
          } else {
            // Generate new audio
            const needsChunking = content.length > 1500;
            const generated = await generateSpeech(content, {
              chunked: needsChunking
            });

            if (!generated) {
              showToast('Could not generate audio automatically.', 'error');
              setIsGeneratingVoice(false);
              setGeneratingAudioId(null);
              return;
            }

            audioResult = typeof generated === 'string' ? generated : generated[0];
            const audioData = Array.isArray(generated) ? generated : [generated];
            setCurrentAudioBase64(audioData);

            // Update history entry with audio
            setHistory(prev => prev.map(h =>
              h.id === newId ? { ...h, audioBase64: audioResult || undefined } : h
            ));

            // Cache the audio in IndexedDB
            if (typeof generated === 'string') {
              await audioCache.set(content, generated);
            }
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

              // Save optimized version if available, otherwise save original
              const audioToSave = optimized || audioResult;
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

          // Play audio only if auto-play is enabled
          if (autoPlayEnabled && audioResult) {
            // Use the audio data we already prepared
            const audioDataToPlay = typeof audioResult === 'string'
              ? [audioResult]
              : (cached && Array.isArray(cached) ? cached : [audioResult]);
            playAudio(audioDataToPlay, 'main');
          }
        } catch (error) {
          console.error('Auto TTS generation error:', error);
          showToast('Error generating speech automatically.', 'error');
        } finally {
          setIsGeneratingVoice(false);
          setGeneratingAudioId(null);
        }
      })();

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
    }
  }, [entry, selectedMood, history]);

  const handleSendMessage = async (text: string) => {
    if (!chatSessionRef.current) {
      if (!reflection) return;
      // Always use the latest history state to ensure deleted entries are excluded
      chatSessionRef.current = startJournalChat(entry, reflection.content, selectedMood, history, reflection.topic);
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
      const response = await chatSessionRef.current.sendMessage({ message: text });
      const modelText = response.text || "I'm here listening, but I couldn't find the right words just now.";
      const newModelMsg: ChatMessage = { role: 'model', text: modelText };

      const updatedMessagesWithModel = [...updatedMessagesWithUser, newModelMsg];
      setChatMessages(updatedMessagesWithModel);
      updateHistoryWithChat(updatedMessagesWithModel);

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
          if (autoPlayEnabled) {
            playAudio(audioData, id);
          }
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
            if (autoPlayEnabled) {
              playAudio(audioData, id);
            }
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
      } catch (error) {
        console.error('Failed to clear history from Supabase:', error);
        showToast('Failed to clear history', 'error');
        // Try to reload history on error
        try {
          const loadedHistory = await historyService.fetchHistory();
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

      {/* Audio Sync Indicator */}
      {isAudioSyncing && audioSyncProgress && (
        <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-center gap-3 text-sm">
          <div className="flex-shrink-0">
            <svg className="animate-spin h-4 w-4 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          </div>
          <div className="flex-grow min-w-0">
            <div className="text-blue-700 font-medium">Syncing audio to cloud...</div>
            <div className="text-blue-600 text-xs mt-1">
              {audioSyncProgress.processed} / {audioSyncProgress.total} ({audioSyncProgress.saved} saved)
            </div>
            <div className="w-full bg-blue-200 rounded-full h-1.5 mt-2">
              <div
                className="bg-blue-600 h-1.5 rounded-full transition-all duration-300"
                style={{ width: `${(audioSyncProgress.processed / audioSyncProgress.total) * 100}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {isDemoMode && (
        <div className="mb-6 p-4 bg-amber-50/50 border border-amber-200/50 rounded-lg flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <p className="text-sm font-medium text-amber-900">Demo Mode</p>
              <p className="text-xs text-amber-700 font-light">Your entries won't be saved. <button onClick={() => window.location.href = '/login'} className="underline hover:text-amber-900">Sign in to save your thoughts.</button></p>
            </div>
          </div>
          <button
            onClick={handleExitDemo}
            className="text-xs text-amber-700 hover:text-amber-900 font-medium px-3 py-1 rounded-full hover:bg-amber-100 transition-colors"
          >
            Exit Demo
          </button>
        </div>
      )}

      <header className="mb-8 md:mb-12 text-center md:text-left flex flex-col md:flex-row md:items-end md:justify-between border-b border-stone-100 pb-6 md:pb-8">
        <div>
          <h1 className="text-2xl md:text-4xl font-light text-stone-800 tracking-tight font-serif mb-1 md:mb-2">
            Serenity Journal
          </h1>
          <p className="text-stone-500 text-xs md:text-base font-light">
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
          </div>

          <div className="flex items-center gap-2 md:gap-3">
            <button
              onClick={() => setViewMode(viewMode === ViewMode.JOURNAL ? ViewMode.HISTORY : ViewMode.JOURNAL)}
              className="flex items-center gap-1.5 text-stone-500 hover:text-emerald-700 text-xs md:text-sm transition-colors px-3 py-1 rounded-full hover:bg-emerald-50"
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
                    className="flex items-center gap-1.5 text-stone-400 hover:text-stone-600 text-xs md:text-sm transition-colors px-3 py-1 rounded-full hover:bg-stone-50"
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
                    className="flex items-center gap-1.5 text-emerald-600 hover:text-emerald-700 text-xs md:text-sm transition-colors px-3 py-1 rounded-full hover:bg-emerald-50 font-medium"
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
                className="w-full min-h-[250px] md:min-h-[350px] bg-transparent text-lg md:text-2xl font-light text-stone-800 placeholder-stone-300 border-none outline-none focus:ring-0 focus:outline-none resize-none p-0 leading-[1.6] mb-4 transition-all duration-300 overflow-hidden"
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

            <div className="sticky bottom-0 md:bottom-8 py-4 md:py-6 bg-gradient-to-t from-[#FDFCF8] via-[#FDFCF8] to-transparent flex flex-col md:flex-row gap-3 md:gap-4 z-10 sticky-bottom-safe">
              <button
                onClick={handleGetReflection}
                disabled={isButtonDisabled}
                className={`
                  group relative flex-grow md:flex-initial px-8 md:px-10 py-3.5 md:py-4 rounded-full font-medium transition-all duration-300 active:scale-95
                  ${isButtonDisabled
                    ? 'bg-stone-100 text-stone-300 cursor-not-allowed opacity-50'
                    : 'bg-emerald-800 text-emerald-50 hover:bg-emerald-900 shadow-md hover:shadow-lg'}
                `}
              >
                <span className="flex items-center justify-center gap-2 text-sm md:text-base">
                  {status === AppStatus.LOADING ? (
                    <><svg className="animate-spin h-4 w-4 md:h-5 md:w-5 text-stone-300" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Reflecting...</>
                  ) : (
                    <>Get Reflection <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 md:h-5 md:w-5 transition-transform group-hover:translate-x-1" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M12.293 5.293a1 1 0 011.414 0l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-2.293-2.293a1 1 0 010-1.414z" clipRule="evenodd" /></svg></>
                  )}
                </span>
              </button>

              {isMounted ? (
                <AlertDialog.Root open={showStartNewDialog} onOpenChange={setShowStartNewDialog}>
                  <AlertDialog.Trigger asChild>
                    <button
                      className="px-6 py-2 md:py-4 rounded-full text-stone-400 hover:text-stone-600 hover:bg-stone-100 transition-all text-xs md:text-sm font-medium"
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
              onTogglePlayback={handleTogglePlayback}
              isPlaying={isPlayingAudio && activeAudioId === 'main'}
              isPaused={isPaused && activeAudioId === 'main'}
              isGeneratingVoice={isGeneratingVoice && generatingAudioId === 'main'}
              playbackRate={playbackRate}
              onPlaybackRateChange={setPlaybackSpeed}
              onStop={stopCurrentAudio}
            />

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
            onClick={() => setAutoPlayEnabled(!autoPlayEnabled)}
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
