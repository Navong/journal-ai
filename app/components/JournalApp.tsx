'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Reflection, AppStatus, ViewMode, HistoryEntry, Mood, ReflectionProgress } from '../types';
import { getJournalReflection } from '../services/geminiService';
import { ReflectionCard } from './ReflectionCard';
import { HistoryView } from './HistoryView';
import { showToast, ToastContainer } from '../utils/toast';
import { generateUUID } from '../utils/uuid';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { useSession, signOut } from 'next-auth/react';
import { historyService } from '../services/historyService';

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

const MOODS: { label: string; value: Mood; color: string; dot: string }[] = [
  { label: 'Calm', value: 'calm', color: '#7C9885', dot: '#A8C5B0' },
  { label: 'Joyful', value: 'joyful', color: '#C4956A', dot: '#D4A97A' },
  { label: 'Reflective', value: 'reflective', color: '#8A7B6E', dot: '#A89B8E' },
  { label: 'Heavy', value: 'heavy', color: '#6E7A7A', dot: '#8E9A9A' },
  { label: 'Anxious', value: 'anxious', color: '#9B7FA6', dot: '#B595C0' },
  { label: 'Tired', value: 'tired', color: '#7A8FA6', dot: '#95A8C0' },
];

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

  const [autoPlayEnabled, setAutoPlayEnabled] = useState<boolean>(false); // Default to false until preferences load

  // Minimal audio playback (single HTMLAudioElement)
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [activeAudioEntryId, setActiveAudioEntryId] = useState<string | null>(null);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [generatingAudioEntryId, setGeneratingAudioEntryId] = useState<string | null>(null);

  // Reflection generation progress tracking
  const [reflectionProgress, setReflectionProgress] = useState<ReflectionProgress | null>(null);

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
                setHistory(parsed);
                console.log(`[JournalApp] ✅ Loaded ${parsed.length} entries from localStorage (demo)`);
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

              // Migrate localStorage data to Supabase if exists
              const legacyHistory = localStorage.getItem(LEGACY_HISTORY_KEY);
              const legacyUserHistory = localStorage.getItem(`serenity_journal_history_${currentUserId}`);
              const historyToMigrate = legacyUserHistory || legacyHistory;

              if (historyToMigrate && loadedHistory.length === 0) {
                try {
                  const parsed = JSON.parse(historyToMigrate);

                  if (parsed.length > 0) {
                    console.log(`[JournalApp] Migrating ${parsed.length} entries from localStorage to DB`);
                    // Save to Supabase
                    await historyService.saveEntries(parsed);
                    setHistory(parsed);
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
                  setHistory(parsed);
                  console.log(`[JournalApp] ✅ Loaded ${parsed.length} entries from localStorage (fallback)`);
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

  const stopAudio = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    setIsPlayingAudio(false);
    setActiveAudioEntryId(null);
  }, []);

  const playReflectionAudio = useCallback((entryId: string, audioUrl: string) => {
    try {
      let audio = audioRef.current;
      if (!audio) {
        audio = new Audio();
        audioRef.current = audio;
      }

      // If toggling the currently-playing entry, stop it.
      if (activeAudioEntryId === entryId && isPlayingAudio) {
        audio.pause();
        audio.currentTime = 0;
        setIsPlayingAudio(false);
        setActiveAudioEntryId(null);
        return;
      }

      // Switch to this entry
      audio.pause();
      audio.currentTime = 0;
      audio.src = audioUrl;

      setActiveAudioEntryId(entryId);
      setIsPlayingAudio(true);

      audio.onended = () => {
        setIsPlayingAudio(false);
        setActiveAudioEntryId(null);
      };
      audio.onerror = () => {
        setIsPlayingAudio(false);
        setActiveAudioEntryId(null);
        showToast('Audio playback failed', 'error');
      };

      void audio.play().catch((err) => {
        setIsPlayingAudio(false);
        setActiveAudioEntryId(null);
        console.error('Audio play failed:', err);
        showToast('Audio playback was blocked by the browser', 'error');
      });
    } catch (err) {
      console.error('playReflectionAudio error:', err);
      showToast('Audio playback failed', 'error');
    }
  }, [activeAudioEntryId, isPlayingAudio]);

  const generateReflectionAudio = useCallback(async (entryId: string, text: string) => {
    if (generatingAudioEntryId) return;
    setGeneratingAudioEntryId(entryId);
    try {
      const resp = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entryId, text }),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data?.message || data?.error || `TTS failed (${resp.status})`);
      }
      const data = await resp.json();
      const audioUrl = data?.audioUrl as string | undefined;
      if (!audioUrl) throw new Error('No audioUrl returned');

      setHistory((prev) => {
        const next = prev.map((h) => (h.id === entryId ? { ...h, reflectionAudioUrl: audioUrl } : h));
        if (!isDemoMode && userId) {
          const merged = next.find((h) => h.id === entryId);
          if (merged) {
            void historyService.saveEntries([merged]).catch((err) => {
              console.error('[JournalApp] Failed to persist reflectionAudioUrl via history API', err);
            });
          }
        }
        return next;
      });

      showToast('Voice generated', 'success');
    } catch (err: any) {
      console.error('generateReflectionAudio failed:', err);
      showToast(err?.message || 'Failed to generate voice', 'error');
    } finally {
      setGeneratingAudioEntryId(null);
    }
  }, [generatingAudioEntryId, isDemoMode, userId]);

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
            console.log(`[JournalApp] ✅ Reloaded ${parsed.length} entries for History view (demo)`);
            setHistory(parsed);
          } catch (e) {
            console.error('[JournalApp] Error parsing demo history:', e);
          }
        }
      }
    }
  }, [viewMode, userId, isDemoMode, isMounted]); // Re-run when viewMode changes to HISTORY

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
        localStorage.setItem(currentHistoryKey, JSON.stringify(history));
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
                localStorage.setItem(currentHistoryKey, JSON.stringify(history));
              } else {
                console.log(`✅ Successfully saved ${history.length} entries to database for user ${userId}`);
              }
            }

            // Save preferences to localStorage as backup
            localStorage.setItem(currentAutoPlayKey, autoPlayEnabled.toString());
          } catch (error) {
            console.error('Unexpected error saving to Supabase:', error);
            // Fallback to localStorage if Supabase fails
            localStorage.setItem(currentHistoryKey, JSON.stringify(history));
            localStorage.setItem(currentAutoPlayKey, autoPlayEnabled.toString());
          }
        };

        saveToSupabase();
      }
    } else if (typeof window !== 'undefined' && !isHydratedRef.current) {
      console.log('Skipping save - not yet hydrated');
    }
  }, [history, autoPlayEnabled, isDemoMode, userId, currentHistoryKey, currentAutoPlayKey]);

  const handleEntryChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setEntry(e.target.value);
  };

  const handleGetReflection = useCallback(async () => {
    if (!entry.trim()) return;

    setStatus(AppStatus.LOADING);
    setError(null);
    setReflectionProgress(null); // Clear previous progress

    try {
      const { reflection: content, summary, topic, mood: detectedMood, entities, highlights } = await getJournalReflection(entry, selectedMood, history, (progress) => {
        console.log('[JournalApp] Progress update:', progress.stage, progress.message);
        setReflectionProgress(progress);
      });
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
        entities: entities, // Save extracted entities
        highlights: highlights // Save AI-detected highlights
      };
      console.log(`[JournalApp] Created history entry with topic: "${topic}", entities:`, entities, 'highlights:', highlights);

      setHistory(prev => [newHistoryEntry, ...prev]);

      // Save entry to database
      if (userId && !isDemoMode) {
        setTimeout(() => {
          if (isHydratedRef.current) {
            console.log(`[JournalApp] Immediately saving new entry ${newId} for user ${userId}`);
            historyService.saveEntries([newHistoryEntry]).catch(error => {
              console.error('[JournalApp] Failed to immediately save new entry:', error);
            });
          } else {
            console.log('[JournalApp] Not hydrated yet, will save via useEffect');
          }
        }, 100);
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

  const handleStartFresh = () => {
    setShowStartNewDialog(false);
    setSessionKey(prev => prev + 1);
    setEntry('');
    setReflection(null);
    setStatus(AppStatus.IDLE);
    setError(null);
    setCurrentHistoryId(null);
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

    // Delete from Supabase or localStorage
    if (isDemoMode) {
      // Demo mode: update localStorage
      const updatedHistory = currentHistory.filter(e => e.id !== id);
      localStorage.setItem(currentHistoryKey, JSON.stringify(updatedHistory));
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

    showToast('Entry deleted', 'success');
  };

  const clearAllHistory = async () => {
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
    <div className="min-h-screen flex flex-col" style={{ maxWidth: 680, margin: '0 auto', padding: '48px 24px 80px' }}>
      <ToastContainer />

      {isDemoMode && (
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3" style={{ marginBottom: 24, padding: '10px 16px', background: '#F4F1EB', border: '1px solid #E0D8CE', borderRadius: 4 }}>
          <div className="flex items-center gap-2.5 flex-1 min-w-0">
            <svg xmlns="http://www.w3.org/2000/svg" className="flex-shrink-0" style={{ width: 14, height: 14, color: '#B5A47A' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p style={{ fontSize: 11, color: '#7A6E60', margin: 0, lineHeight: 1.5, fontFamily: "'Helvetica Neue', sans-serif" }}>
              <span style={{ letterSpacing: '0.06em', textTransform: 'uppercase', color: '#5C4F3D', marginRight: 6 }}>Demo Mode</span>
              Your entries won't be saved. <button onClick={() => window.location.href = '/login'} style={{ textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer', color: '#7A6E60', padding: 0 }}>Sign in</button>
            </p>
          </div>
          <button
            onClick={handleExitDemo}
            style={{ fontSize: 10, color: '#7A6E60', background: 'none', border: '1px solid #D4CCC0', borderRadius: 3, padding: '4px 12px', cursor: 'pointer', flexShrink: 0, letterSpacing: '0.08em', textTransform: 'uppercase', fontFamily: "'Helvetica Neue', sans-serif" }}
          >
            Exit Demo
          </button>
        </div>
      )}

      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', borderBottom: '1px solid #E8E4DD', paddingBottom: 24, marginBottom: 48 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 400, letterSpacing: '-0.02em', color: '#2C2825', margin: 0, lineHeight: 1, fontFamily: 'Georgia, serif' }}>Serenity</h1>
          <p style={{ fontSize: 12, color: '#A89E92', marginTop: 6, marginBottom: 0, letterSpacing: '0.08em', fontFamily: "'Helvetica Neue', sans-serif", textTransform: 'uppercase' }}>A quiet space for your thoughts</p>
        </div>
        <nav style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
          <button
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: "'Helvetica Neue', sans-serif", color: viewMode === ViewMode.JOURNAL ? '#5C4F3D' : '#B5A99A', paddingBottom: 2, borderBottom: viewMode === ViewMode.JOURNAL ? '1px solid #5C4F3D' : '1px solid transparent', transition: 'all 0.2s' }}
            onClick={() => setViewMode(ViewMode.JOURNAL)}
          >
            Journal
          </button>
          <button
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, letterSpacing: '0.1em', textTransform: 'uppercase', fontFamily: "'Helvetica Neue', sans-serif", color: viewMode === ViewMode.HISTORY ? '#5C4F3D' : '#B5A99A', paddingBottom: 2, borderBottom: viewMode === ViewMode.HISTORY ? '1px solid #5C4F3D' : '1px solid transparent', transition: 'all 0.2s' }}
            onClick={() => setViewMode(ViewMode.HISTORY)}
          >
            History
          </button>
          {(session?.user || isDemoMode) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
                  style={{ width: 28, height: 28, borderRadius: '50%', background: '#E8E4DD', border: 'none', cursor: 'pointer', fontSize: 12, color: '#7A6E60', fontFamily: 'sans-serif', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  title="Sign out"
                >
                  {session.user.email?.[0]?.toUpperCase() || 'U'}
                </button>
              ) : isDemoMode && (
                <button
                  onClick={() => window.location.href = '/login'}
                  style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', fontFamily: "'Helvetica Neue', sans-serif", color: '#7A6E60', background: 'none', border: '1px solid #E0D8CE', borderRadius: 12, padding: '4px 12px', cursor: 'pointer' }}
                >Sign in</button>
              )}
            </div>
          )}
        </nav>
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
                style={{ width: '100%', background: 'transparent', border: 'none', outline: 'none', resize: 'none', fontSize: 20, lineHeight: 1.7, color: '#3A3530', fontFamily: 'Georgia, serif', fontWeight: 400, minHeight: 200, padding: 0, boxSizing: 'border-box' as const }}
                disabled={status === AppStatus.LOADING}
                autoFocus
              />

              {entry.length > 0 && (
                <div style={{ fontSize: 11, color: '#C4BAB0', letterSpacing: '0.08em', fontFamily: "'Helvetica Neue', sans-serif", textTransform: 'uppercase', textAlign: 'right', marginTop: 8 }}>
                  {wordCount} {wordCount === 1 ? 'word' : 'words'}
                </div>
              )}
            </div>

            {/* Mood selector */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 24, marginBottom: 32 }}>
              {MOODS.map(m => (
                <button
                  key={m.value}
                  onClick={() => setSelectedMood(selectedMood === m.value ? 'none' : m.value)}
                  style={{
                    padding: '6px 14px',
                    borderRadius: 20,
                    border: selectedMood === m.value ? `1.5px solid ${m.color}` : '1.5px solid #E0D8CE',
                    background: selectedMood === m.value ? `${m.dot}22` : 'transparent',
                    color: selectedMood === m.value ? m.color : '#A89E92',
                    fontSize: 12,
                    fontFamily: "'Helvetica Neue', sans-serif",
                    letterSpacing: '0.05em',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 8 }}>
              <button
                onClick={handleGetReflection}
                disabled={isButtonDisabled && status !== AppStatus.LOADING}
                style={{
                  background: isButtonDisabled ? '#E8E4DD' : '#3A3530',
                  color: isButtonDisabled ? '#B5A99A' : '#FDFCF8',
                  border: 'none',
                  borderRadius: 3,
                  padding: '14px 32px',
                  fontSize: 13,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  fontFamily: "'Helvetica Neue', sans-serif",
                  cursor: isButtonDisabled ? 'not-allowed' : 'pointer',
                  transition: 'all 0.3s',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                {status === AppStatus.LOADING ? (
                  <>
                    <svg className="animate-spin" style={{ width: 14, height: 14 }} viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Reflecting...
                  </>
                ) : (
                  'Reflect'
                )}
              </button>

              {isMounted ? (
                <AlertDialog.Root open={showStartNewDialog} onOpenChange={setShowStartNewDialog}>
                  <AlertDialog.Trigger asChild>
                    <button
                      style={{ background: 'transparent', color: '#A89E92', border: '1px solid #E0D8CE', borderRadius: 3, padding: '14px 24px', fontSize: 13, letterSpacing: '0.12em', textTransform: 'uppercase', fontFamily: "'Helvetica Neue', sans-serif", cursor: 'pointer' }}
                    >
                      Start New
                    </button>
                  </AlertDialog.Trigger>
                  <AlertDialog.Portal>
                    <AlertDialog.Overlay className="fixed inset-0 bg-black/20 backdrop-blur-sm z-50 animate-in fade-in" />
                    <AlertDialog.Content
                      className="fixed top-1/2 left-1/2 max-w-md w-[90vw] z-50 animate-in fade-in zoom-in-95 duration-200"
                      style={{
                        background: '#FDFCF8',
                        borderRadius: 12,
                        boxShadow: '0 20px 60px rgba(44,40,37,0.15)',
                        border: '1px solid #E8E4DD',
                        padding: '32px',
                        transform: 'translate(-50%, -50%)',
                      }}
                    >
                      <AlertDialog.Title style={{ fontSize: 20, fontWeight: 400, color: '#2C2825', fontFamily: 'Georgia, serif', marginBottom: 8, marginTop: 0 }}>
                        Start New Session?
                      </AlertDialog.Title>
                      <AlertDialog.Description style={{ color: '#7A6E60', marginBottom: 24, fontSize: 14, lineHeight: 1.6 }}>
                        This will clear your current writing and reflection. Your previous entries will be saved in history.
                      </AlertDialog.Description>
                      <div className="flex gap-3 justify-end">
                        <AlertDialog.Cancel asChild>
                          <button style={{ padding: '8px 16px', borderRadius: 20, color: '#7A6E60', background: 'none', border: '1px solid #E0D8CE', cursor: 'pointer', fontSize: 13 }}>
                            Cancel
                          </button>
                        </AlertDialog.Cancel>
                        <AlertDialog.Action asChild>
                          <button
                            onClick={handleStartFresh}
                            style={{ padding: '8px 16px', borderRadius: 20, background: '#3A3530', color: '#FDFCF8', border: 'none', cursor: 'pointer', fontSize: 13 }}
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
                  style={{ background: 'transparent', color: '#A89E92', border: '1px solid #E0D8CE', borderRadius: 3, padding: '14px 24px', fontSize: 13, letterSpacing: '0.12em', textTransform: 'uppercase', fontFamily: "'Helvetica Neue', sans-serif", cursor: 'pointer' }}
                >
                  Start New
                </button>
              )}
            </div>

            {error && <p className="mt-4 text-rose-500 text-xs md:text-sm text-center md:text-left font-medium">{error}</p>}

            <ReflectionCard
              reflection={reflection}
              isLoading={status === AppStatus.LOADING}
              audioActions={
                userId && !isDemoMode && reflection && currentHistoryId ? (
                  (() => {
                    const currentEntry = history.find(h => h.id === currentHistoryId);
                    const audioUrl = currentEntry?.reflectionAudioUrl;
                    const isThisGenerating = generatingAudioEntryId === currentHistoryId;
                    const isThisPlaying = activeAudioEntryId === currentHistoryId && isPlayingAudio;

                    return audioUrl ? (
                      <>
                        <button
                          type="button"
                          onClick={() => playReflectionAudio(currentHistoryId, audioUrl)}
                          disabled={isThisGenerating}
                          className="transition-all p-4 md:p-3.5 rounded-full active:scale-90 touch-manipulation min-h-[56px] min-w-[56px] md:min-h-[52px] md:min-w-[52px] flex items-center justify-center"
                          style={{
                            background: isThisPlaying ? '#DFF3E6' : '#EEE9E1',
                            color: '#3A3530',
                            opacity: isThisGenerating ? 0.6 : 1,
                            cursor: isThisGenerating ? 'not-allowed' : 'pointer',
                          }}
                          title={isThisPlaying ? 'Playing' : 'Play'}
                        >
                          {isThisPlaying ? (
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7 md:h-6 md:w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M10 9v6m4-6v6" />
                            </svg>
                          ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7 md:h-6 md:w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                            </svg>
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={stopAudio}
                          disabled={!isThisPlaying}
                          className="transition-all p-4 md:p-3.5 rounded-full active:scale-90 touch-manipulation min-h-[56px] min-w-[56px] md:min-h-[52px] md:min-w-[52px] flex items-center justify-center"
                          style={{
                            background: '#EEE9E1',
                            color: '#6B5F52',
                            opacity: isThisPlaying ? 1 : 0.5,
                            cursor: isThisPlaying ? 'pointer' : 'not-allowed',
                          }}
                          title="Stop"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7 md:h-6 md:w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 10h6v4H9z" />
                          </svg>
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => generateReflectionAudio(currentHistoryId, reflection.content)}
                        disabled={isThisGenerating}
                        className="transition-all px-5 py-3 rounded-full active:scale-95 touch-manipulation text-sm md:text-[13px] min-h-[48px]"
                        style={{
                          background: '#EEE9E1',
                          color: '#3A3530',
                          letterSpacing: '0.12em',
                          textTransform: 'uppercase',
                          fontFamily: "'Helvetica Neue', sans-serif",
                          opacity: isThisGenerating ? 0.6 : 1,
                          cursor: isThisGenerating ? 'not-allowed' : 'pointer',
                        }}
                        title="Generate voice"
                      >
                        {isThisGenerating ? 'Generating…' : 'Generate voice'}
                      </button>
                    );
                  })()
                ) : null
              }
            />

          </div>
        ) : (
          <HistoryView
            history={history}
            onBack={() => setViewMode(ViewMode.JOURNAL)}
            onDeleteEntry={deleteHistoryEntry}
            onClearAll={clearAllHistory}
            onPlayReflectionAudio={playReflectionAudio}
            onStopAudio={stopAudio}
            activeAudioEntryId={activeAudioEntryId}
            isPlayingAudio={isPlayingAudio}
            onGenerateReflectionAudio={generateReflectionAudio}
            generatingAudioEntryId={generatingAudioEntryId}
          />
        )}
      </main>

      <footer style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: 'linear-gradient(to top, #FDFCF8 70%, transparent)', padding: '16px 24px 20px', textAlign: 'center', pointerEvents: 'none' }}>
        <p style={{ fontSize: 10, color: '#C4BAB0', letterSpacing: '0.08em', textTransform: 'uppercase', fontFamily: "'Helvetica Neue', sans-serif", margin: 0 }}>
          Your thoughts are private and safe.
        </p>
      </footer>
    </div>
  );
};

export default JournalApp;
