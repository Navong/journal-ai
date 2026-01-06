'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { HistoryEntry } from '../types';
import { historyService } from '../services/historyService';
import { showToast } from '../utils/toast';

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

interface HistoryManagerProps {
    userId: string | null;
    isDemoMode: boolean;
    history: HistoryEntry[];
    autoPlayEnabled: boolean;
    onHistoryChange: (history: HistoryEntry[]) => void;
    onAutoPlayChange: (enabled: boolean) => void;
    onPreferencesLoaded: (loaded: boolean) => void;
    children: (props: {
        onDeleteEntry: (id: string) => Promise<void>;
        onClearAllHistory: () => Promise<void>;
    }) => React.ReactNode;
}

export const HistoryManager: React.FC<HistoryManagerProps> = ({
    userId,
    isDemoMode,
    history,
    autoPlayEnabled,
    onHistoryChange,
    onAutoPlayChange,
    onPreferencesLoaded,
    children
}) => {
    const isHydratedRef = useRef(false);
    const prevUserIdRef = useRef<string | null>(null);
    const prevDemoModeRef = useRef<boolean>(false);

    // Get current keys
    const currentHistoryKey = getHistoryKey(userId, isDemoMode);
    const currentAutoPlayKey = getAutoPlayKey(userId, isDemoMode);

    // Load history and preferences on mount or when user changes
    useEffect(() => {
        if (typeof window !== 'undefined') {
            const currentUserId = userId;
            const currentDemoMode = isDemoMode;
            const previousUserId = prevUserIdRef.current;
            const previousDemoMode = prevDemoModeRef.current;

            console.log('[HistoryManager] Load effect triggered:', {
                currentUserId,
                currentDemoMode,
                previousUserId,
                previousDemoMode,
                isHydrated: isHydratedRef.current
            });

            const isInitialHydration = !isHydratedRef.current;
            const isUserChange = previousUserId !== currentUserId;
            const isModeChange = previousDemoMode !== currentDemoMode;

            // Run on initial hydration or when user/demo mode changes
            const shouldLoad = isInitialHydration || isUserChange || isModeChange;

            if (shouldLoad) {
                console.log('[HistoryManager] Loading data - reason:', {
                    isInitialHydration,
                    isUserChange,
                    isModeChange
                });

                // Clear history and reset state immediately when switching users
                if (!isInitialHydration && (isUserChange || isModeChange)) {
                    onHistoryChange([]);
                    onAutoPlayChange(true); // Reset to default
                }

                const loadData = async () => {
                    // Double-check user hasn't changed during async operation
                    // Allow loading if prevUserId is null (first time setting it) OR if this is initial hydration
                    if (prevUserIdRef.current !== null && prevUserIdRef.current !== currentUserId && !isInitialHydration) {
                        console.log('[HistoryManager] User changed during wait, aborting load');
                        return;
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
                                onHistoryChange(cleanedHistory);
                                console.log(`[HistoryManager] ✅ Loaded ${cleanedHistory.length} entries from localStorage (demo)`);
                            } catch (e) {
                                console.error('Error parsing demo history:', e);
                                onHistoryChange([]);
                            }
                        } else {
                            onHistoryChange([]);
                        }

                        const savedAutoPlay = localStorage.getItem(currentAutoPlayKey);
                        if (savedAutoPlay !== null) {
                            onAutoPlayChange(savedAutoPlay === 'true');
                        } else {
                            onAutoPlayChange(false); // Default to false for new demo users
                        }
                        onPreferencesLoaded(true);
                    } else if (currentUserId) {
                        // Authenticated: use Supabase
                        try {
                            console.log(`[HistoryManager] Loading data for authenticated user: ${currentUserId}`);

                            // Double-check user hasn't changed before making API call
                            // Allow loading if prevUserId is null (first time setting it) OR if this is initial hydration
                            if (prevUserIdRef.current !== null && prevUserIdRef.current !== currentUserId && !isInitialHydration) {
                                console.log('[HistoryManager] User changed before API call, aborting load');
                                return;
                            }

                            console.log('[HistoryManager] Fetching history and preferences...');
                            // Load all history entries (no pagination for better UX)
                            const [historyResult, preferences] = await Promise.all([
                                historyService.fetchHistory(),
                                historyService.getPreferences(),
                            ]);

                            // Handle both old format (array) and new format (object with entries)
                            const loadedHistory = Array.isArray(historyResult)
                                ? historyResult
                                : historyResult.entries || [];

                            console.log(`[HistoryManager] Received ${loadedHistory.length} entries and preferences:`, preferences);

                            // Final check before setting state
                            // Allow loading if prevUserId is null (first time setting it) OR if this is initial hydration
                            if (prevUserIdRef.current !== null && prevUserIdRef.current !== currentUserId && !isInitialHydration) {
                                console.log('[HistoryManager] User changed during API call, aborting state update');
                                return;
                            }

                            console.log(`[HistoryManager] ✅ Setting history with ${loadedHistory.length} entries`);
                            onHistoryChange(loadedHistory);

                            if (preferences) {
                                onAutoPlayChange(preferences.auto_play_enabled);
                                console.log(`[HistoryManager] ✅ Set autoPlayEnabled to ${preferences.auto_play_enabled}`);
                            } else {
                                onAutoPlayChange(false); // Default to false if no preferences found
                            }
                            onPreferencesLoaded(true);

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
                                        console.log(`[HistoryManager] Migrating ${cleanedHistory.length} entries from localStorage to DB`);
                                        // Save to Supabase
                                        await historyService.saveEntries(cleanedHistory);
                                        onHistoryChange(cleanedHistory);
                                        // Clear migrated localStorage
                                        if (legacyUserHistory) {
                                            localStorage.removeItem(`serenity_journal_history_${currentUserId}`);
                                        }
                                        if (legacyHistory) {
                                            localStorage.removeItem(LEGACY_HISTORY_KEY);
                                        }
                                        console.log('[HistoryManager] ✅ Migration completed');
                                    }
                                } catch (e) {
                                    console.error('Error migrating history:', e);
                                }
                            }
                        } catch (error) {
                            console.error('[HistoryManager] Failed to load history from Supabase:', error);
                            // Fallback to localStorage if Supabase fails
                            const savedHistory = localStorage.getItem(currentHistoryKey);
                            if (savedHistory) {
                                try {
                                    const parsed = JSON.parse(savedHistory);
                                    const cleanedHistory = parsed.map((entry: any) => {
                                        const { audioBase64, ...rest } = entry;
                                        return rest;
                                    });
                                    onHistoryChange(cleanedHistory);
                                    console.log(`[HistoryManager] ✅ Loaded ${cleanedHistory.length} entries from localStorage (fallback)`);
                                } catch (e) {
                                    console.error('Error parsing fallback history:', e);
                                    onHistoryChange([]);
                                }
                            } else {
                                onHistoryChange([]);
                            }

                            // Load auto-play preference from localStorage as fallback
                            const savedAutoPlay = localStorage.getItem(currentAutoPlayKey);
                            if (savedAutoPlay !== null) {
                                onAutoPlayChange(savedAutoPlay === 'true');
                            } else {
                                onAutoPlayChange(false);
                            }
                            onPreferencesLoaded(true);
                        }
                    } else {
                        // No session
                        onHistoryChange([]);
                        onAutoPlayChange(false);
                        onPreferencesLoaded(true);
                    }

                    // Update refs AFTER data is loaded
                    prevUserIdRef.current = currentUserId;
                    prevDemoModeRef.current = currentDemoMode;
                    isHydratedRef.current = true;
                };

                loadData();
            }
        }
    }, [userId, isDemoMode]); // Re-run when user/demo/session/status changes

    // Save history to Supabase (or localStorage for demo) whenever it changes
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
                localStorage.setItem(currentHistoryKey, JSON.stringify(historyWithoutAudio));
                localStorage.setItem(currentAutoPlayKey, autoPlayEnabled.toString());
                console.log(`Saved ${history.length} entries to localStorage (demo mode)`);
            } else if (userId) {
                // Authenticated: use Supabase
                const saveToSupabase = async () => {
                    // Check again before saving
                    if (prevUserIdRef.current !== userId) {
                        console.log('Aborting save - user changed during async operation');
                        return;
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

                        // Check preferences result
                        if (results[0].status === 'rejected') {
                            console.error('Failed to save preferences:', results[0].reason);
                        } else {
                            console.log('Preferences saved successfully');
                        }

                        // Check history result
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
                        // Fallback to localStorage
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

    // Delete history entry
    const deleteHistoryEntry = useCallback(async (id: string) => {
        // Store current history for potential rollback
        const currentHistory = history;

        // Optimistically update UI
        onHistoryChange(history.filter(entry => entry.id !== id));

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
                onHistoryChange(currentHistory);
                showToast('Failed to delete entry', 'error');
                return;
            }
        }

        showToast('Entry deleted', 'success');
    }, [history, isDemoMode, userId, currentHistoryKey, onHistoryChange]);

    // Clear all history
    const clearAllHistory = useCallback(async () => {
        // Optimistically clear history
        onHistoryChange([]);

        // Clear from Supabase or localStorage
        if (isDemoMode) {
            // Demo mode: clear localStorage
            localStorage.removeItem(currentHistoryKey);
        } else if (userId) {
            // Authenticated: clear from Supabase
            try {
                await historyService.deleteAllEntries();

                // Clear localStorage to prevent migration re-import
                localStorage.removeItem(LEGACY_HISTORY_KEY);
                localStorage.removeItem(`serenity_journal_history_${userId}`);
                localStorage.removeItem(currentHistoryKey);
                console.log('[HistoryManager] Cleared database and localStorage');
            } catch (error) {
                console.error('Failed to clear history from Supabase:', error);
                showToast('Failed to clear history', 'error');
                // Try to reload history
                try {
                    const historyResult = await historyService.fetchHistory();
                    const loadedHistory = Array.isArray(historyResult)
                        ? historyResult
                        : historyResult.entries || [];
                    onHistoryChange(loadedHistory);
                } catch (e) {
                    // Ignore reload errors
                }
                return;
            }
        }

        showToast('All history cleared', 'success');
    }, [isDemoMode, userId, currentHistoryKey, onHistoryChange]);

    return <>{children({
        onDeleteEntry: deleteHistoryEntry,
        onClearAllHistory: clearAllHistory,
    })}</>;
};