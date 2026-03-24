'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Reflection, AppStatus, ViewMode, HistoryEntry, Mood, ChatMessage, ReflectionProgress, TokenUsage, CumulativeTokenUsage } from '../types';
import { getJournalReflection, startJournalChat } from '../services/geminiService';
import { ReflectionCard } from './ReflectionCard';
import { HistoryView } from './HistoryView';
import { ChatInterface } from './ChatInterface';
import { Chat } from '@google/genai';
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

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isChatting, setIsChatting] = useState(false);
  const chatSessionRef = useRef<Chat | null>(null);
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
    setIsChatting(false);
    setChatMessages([]);
    chatSessionRef.current = null;
    setReflectionProgress(null); // Clear previous progress

    try {
      // Clear context revalidation indicator when new reflection is generated
      if (contextRevalidated) {
        setContextRevalidated(false);
      }

      const { reflection: content, summary, topic, mood: detectedMood, entities, highlights, tokenUsage } = await getJournalReflection(entry, selectedMood, history, (progress) => {
        console.log('[JournalApp] Progress update:', progress.stage, progress.message);
        setReflectionProgress(progress);
      });

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

  const updateHistoryWithChat = (messages: ChatMessage[]) => {
    if (!currentHistoryId) return;
    setHistory(prev => prev.map(h =>
      h.id === currentHistoryId ? { ...h, chatHistory: messages } : h
    ));
  };

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
      const response = await chatSessionRef.current!.sendMessage({ message: text });
      const modelText = response.text || "I'm here listening, but I couldn't find the right words just now.";
      const newModelMsg: ChatMessage = { role: 'model', text: modelText };

      const updatedMessagesWithModel = [...updatedMessagesWithUser, newModelMsg];
      setChatMessages(updatedMessagesWithModel);
      updateHistoryWithChat(updatedMessagesWithModel);
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

    // Invalidate chat session if it exists - context needs to be refreshed
    if (chatSessionRef.current) {
      chatSessionRef.current = null;
      // Set indicator to show context will be revalidated
      setContextRevalidated(true);
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
              />
            )}
          </div>
        ) : (
          <HistoryView
            history={history}
            onBack={() => setViewMode(ViewMode.JOURNAL)}
            onDeleteEntry={deleteHistoryEntry}
            onClearAll={clearAllHistory}
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
        </div>
      </footer>
    </div>
  );
};

export default JournalApp;
