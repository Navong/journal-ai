'use client';

import React, { useState, useEffect } from 'react';
import { HistoryEntry } from '../types';
import ReactMarkdown from 'react-markdown';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { EntityTags } from './EntityTags';
import { HighlightedText } from './HighlightedText';
import { historyService } from '../services/historyService';

interface HistoryViewProps {
  history: HistoryEntry[];
  onBack: () => void;
  onDeleteEntry?: (id: string) => void;
  onClearAll?: () => void;
  onPlayAudio?: (text: string, id: string) => void;
  activeAudioId?: string | number | null;
  isPlaying?: boolean;
  isGeneratingVoice?: boolean;
  generatingAudioId?: string | number | null;
}

const ITEMS_PER_PAGE = 5;

export const HistoryView: React.FC<HistoryViewProps> = ({
  history,
  onBack,
  onDeleteEntry,
  onClearAll,
  onPlayAudio,
  activeAudioId,
  isPlaying = false,
  isGeneratingVoice = false,
  generatingAudioId
}) => {
  const [expandedEntries, setExpandedEntries] = useState<Set<string>>(new Set());
  const [deleteDialogId, setDeleteDialogId] = useState<string | null>(null);
  const [showClearAllDialog, setShowClearAllDialog] = useState(false);
  const [displayedHistory, setDisplayedHistory] = useState<HistoryEntry[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  const toggleExpand = (id: string) => {
    const newExpanded = new Set(expandedEntries);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedEntries(newExpanded);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString(undefined, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Initialize displayed history with first page
  useEffect(() => {
    if (history.length > 0) {
      const initialItems = history.slice(0, ITEMS_PER_PAGE);
      setDisplayedHistory(initialItems);
      // If we have exactly ITEMS_PER_PAGE items, assume there might be more (pagination)
      // This handles the case where initial load only fetches first page
      setHasMore(history.length >= ITEMS_PER_PAGE);
      setCurrentPage(1);
    } else {
      setDisplayedHistory([]);
      setHasMore(false);
    }
  }, [history]);

  const handleLoadMore = async () => {
    if (isLoadingMore || !hasMore) return;

    setIsLoadingMore(true);
    try {
      const nextPage = currentPage + 1;
      const offset = nextPage * ITEMS_PER_PAGE;
      
      // Check if we have more items in the already-loaded history
      if (offset < history.length) {
        const nextItems = history.slice(0, offset);
        setDisplayedHistory(nextItems);
        setCurrentPage(nextPage);
        setHasMore(offset < history.length);
      } else {
        // Need to fetch more from server
        const fetchResult = await historyService.fetchHistory({
          limit: ITEMS_PER_PAGE,
          offset: displayedHistory.length
        });
        
        // Handle both old format (array) and new format (object with entries)
        const fetchedHistory = Array.isArray(fetchResult) 
          ? fetchResult 
          : fetchResult.entries || [];
        const hasMoreData = Array.isArray(fetchResult)
          ? fetchedHistory.length === ITEMS_PER_PAGE
          : fetchResult.hasMore ?? (fetchedHistory.length === ITEMS_PER_PAGE);
        
        if (fetchedHistory.length > 0) {
          setDisplayedHistory([...displayedHistory, ...fetchedHistory]);
          setCurrentPage(nextPage);
          setHasMore(hasMoreData);
        } else {
          setHasMore(false);
        }
      }
    } catch (error) {
      console.error('Failed to load more history:', error);
      setHasMore(false);
    } finally {
      setIsLoadingMore(false);
    }
  };

  return (
    <div className="flex flex-col animate-in fade-in duration-500">
      <div className="flex items-center justify-between mb-6 md:mb-12">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-stone-500 hover:text-stone-800 transition-colors group text-sm md:text-base touch-manipulation min-h-[44px] md:min-h-0 px-2 -ml-2 md:ml-0"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 md:h-5 md:w-5 transition-transform group-hover:-translate-x-1" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M7.707 14.707a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l2.293 2.293a1 1 0 010 1.414z" clipRule="evenodd" />
          </svg>
          Back
        </button>

        <div className="flex items-center gap-3">
          {history.length > 0 && onClearAll && (
            <AlertDialog.Root open={showClearAllDialog} onOpenChange={setShowClearAllDialog}>
              <AlertDialog.Trigger asChild>
                <button
                  className="text-stone-400 hover:text-rose-600 text-[10px] md:text-xs tracking-widest uppercase transition-colors px-2 py-1"
                >
                  Clear All
                </button>
              </AlertDialog.Trigger>
              <AlertDialog.Portal>
                <AlertDialog.Overlay className="fixed inset-0 bg-black/20 backdrop-blur-sm z-50 animate-in fade-in" />
                <AlertDialog.Content className="fixed top-1/2 left-1/2 bg-white rounded-2xl shadow-2xl border border-stone-200 p-6 md:p-8 max-w-md w-[90vw] z-50 animate-in fade-in zoom-in-95 duration-200">
                  <AlertDialog.Title className="text-xl md:text-2xl font-semibold text-stone-900 mb-2 font-serif">
                    Clear All History?
                  </AlertDialog.Title>
                  <AlertDialog.Description className="text-stone-600 mb-6 text-sm md:text-base leading-relaxed">
                    This will permanently delete all {history.length} {history.length === 1 ? 'entry' : 'entries'}. This action cannot be undone.
                  </AlertDialog.Description>
                  <div className="flex gap-3 justify-end">
                    <AlertDialog.Cancel asChild>
                      <button className="px-4 py-2 rounded-full text-stone-600 hover:bg-stone-100 transition-colors text-sm font-medium">
                        Cancel
                      </button>
                    </AlertDialog.Cancel>
                    <AlertDialog.Action asChild>
                      <button
                        onClick={() => {
                          if (onClearAll) {
                            onClearAll();
                          }
                          setShowClearAllDialog(false);
                        }}
                        className="px-4 py-2 rounded-full bg-rose-600 text-white hover:bg-rose-700 transition-colors text-sm font-medium"
                      >
                        Clear All
                      </button>
                    </AlertDialog.Action>
                  </div>
                </AlertDialog.Content>
              </AlertDialog.Portal>
            </AlertDialog.Root>
          )}
        </div>
      </div>

      <h2 className="text-2xl md:text-3xl font-serif text-stone-900 mb-8 md:mb-10 px-1 font-semibold">Past Reflections</h2>

      {history.length === 0 ? (
        <div className="py-20 text-center text-stone-400 italic text-sm">
          No past reflections yet.
        </div>
      ) : (
        <>
          <div className="space-y-12 md:space-y-16">
            {displayedHistory.map((item) => {
            const isExpanded = expandedEntries.has(item.id);
            const isLongEntry = item.text.length > 250 || (item.text.match(/\n/g) || []).length > 2;

            return (
              <article key={item.id} className="border-l-2 border-stone-300 pl-6 md:pl-10 relative group">
                <div className="absolute -left-[6px] top-1.5 w-3 h-3 rounded-full bg-emerald-500 shadow-sm"></div>

                {/* Delete Button */}
                {onDeleteEntry && (
                  <AlertDialog.Root open={deleteDialogId === item.id} onOpenChange={(open) => !open && setDeleteDialogId(null)}>
                    <AlertDialog.Trigger asChild>
                      <button
                        onClick={() => setDeleteDialogId(item.id)}
                        className="absolute top-0 right-0 opacity-0 group-hover:opacity-100 transition-opacity p-2 rounded-full text-stone-400 hover:text-rose-600 hover:bg-rose-50 active:scale-90"
                        title="Delete entry"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 md:h-5 md:w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </AlertDialog.Trigger>
                    <AlertDialog.Portal>
                      <AlertDialog.Overlay className="fixed inset-0 bg-black/20 backdrop-blur-sm z-50 animate-in fade-in" />
                      <AlertDialog.Content className="fixed top-1/2 left-1/2 bg-white rounded-2xl shadow-2xl border border-stone-200 p-6 md:p-8 max-w-md w-[90vw] z-50 animate-in fade-in zoom-in-95 duration-200">
                        <AlertDialog.Title className="text-xl md:text-2xl font-semibold text-stone-900 mb-2 font-serif">
                          Delete Entry?
                        </AlertDialog.Title>
                        <AlertDialog.Description className="text-stone-600 mb-6 text-sm md:text-base leading-relaxed">
                          This action cannot be undone. The entry will be permanently deleted from your history.
                        </AlertDialog.Description>
                        <div className="flex gap-3 justify-end">
                          <AlertDialog.Cancel asChild>
                            <button className="px-4 py-2 rounded-full text-stone-600 hover:bg-stone-100 transition-colors text-sm font-medium">
                              Cancel
                            </button>
                          </AlertDialog.Cancel>
                          <AlertDialog.Action asChild>
                            <button
                              onClick={() => {
                                if (onDeleteEntry) {
                                  onDeleteEntry(item.id);
                                }
                                setDeleteDialogId(null);
                              }}
                              className="px-4 py-2 rounded-full bg-rose-600 text-white hover:bg-rose-700 transition-colors text-sm font-medium"
                            >
                              Delete
                            </button>
                          </AlertDialog.Action>
                        </div>
                      </AlertDialog.Content>
                    </AlertDialog.Portal>
                  </AlertDialog.Root>
                )}

                <div className="flex flex-wrap items-center gap-3 mb-4">
                  <time className="text-[11px] md:text-xs text-stone-600 font-semibold tracking-wide uppercase">
                    {formatDate(item.timestamp)}
                  </time>
                </div>

                {/* Essence Summary */}
                {item.summary && (
                  <div className="mb-3 md:mb-4">
                    <p className="text-emerald-800 font-semibold text-sm md:text-base leading-relaxed border-b border-emerald-200/60 pb-2.5">
                      {item.summary}
                    </p>
                  </div>
                )}

                {/* Entity Tags */}
                {item.entities && (
                  <EntityTags entities={item.entities} compact />
                )}

                {/* Journal Entry with Truncation */}
                <div className="mb-5 md:mb-6 relative">
                  <div className={`
                    text-stone-800 font-serif leading-relaxed whitespace-pre-wrap text-sm md:text-base transition-all duration-300
                    ${!isExpanded && isLongEntry ? 'line-clamp-3 overflow-hidden mask-fade-bottom' : ''}
                  `}>
                    {item.text}
                  </div>

                  {isLongEntry && (
                    <button
                      onClick={() => toggleExpand(item.id)}
                      className="mt-3 text-xs md:text-sm font-bold text-emerald-700 uppercase tracking-widest hover:text-emerald-900 transition-colors flex items-center gap-1.5 group py-1.5"
                    >
                      {isExpanded ? (
                        <>Show less <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" /></svg></>
                      ) : (
                        <>Read more <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 group-hover:translate-y-0.5 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg></>
                      )}
                    </button>
                  )}
                </div>

                {/* Reflection Card */}
                <div className="bg-[#F2F6F3] p-4 md:p-6 rounded-xl md:rounded-2xl border border-emerald-100/50 text-stone-800 font-serif text-sm md:text-base leading-relaxed mb-3 md:mb-4 shadow-sm">
                  <HighlightedText 
                    content={item.reflection} 
                    highlights={item.highlights}
                  />
                  {/* Audio Playback Buttons */}
                  {onPlayAudio && (
                    <div className="mt-3 md:mt-4 flex justify-end">
                      {(() => {
                        const audioId = `history-${item.id}`;
                        const isThisAudioActive = isPlaying && activeAudioId === audioId;
                        const isThisGenerating = isGeneratingVoice && generatingAudioId === audioId;

                        return (
                          <button
                            onClick={() => {
                              if (isThisAudioActive) {
                                onPlayAudio?.('', audioId); // Call with empty text to trigger stop
                              } else {
                                onPlayAudio?.(item.reflection, audioId);
                              }
                            }}
                            disabled={isThisGenerating}
                            className={`
                              relative transition-all duration-300 ease-in-out
                              p-2.5 md:p-2 rounded-full 
                              active:scale-90 touch-manipulation 
                              min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0 
                              flex items-center justify-center
                              ${isThisGenerating
                                ? 'bg-stone-100 text-stone-300 cursor-not-allowed opacity-50'
                                : 'text-emerald-600 bg-emerald-50 hover:bg-emerald-100 hover:scale-105'
                              }
                            `}
                            title={isThisGenerating ? "Generating..." : (isThisAudioActive ? "Stop" : "Play")}
                          >
                            {isThisGenerating ? (
                              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                              </svg>
                            ) : (
                              <div className="relative w-4 h-4">
                                {/* Play Icon */}
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  className={`absolute inset-0 h-4 w-4 transition-all duration-300 ease-in-out ${
                                    isThisAudioActive
                                      ? 'opacity-0 scale-0 rotate-90'
                                      : 'opacity-100 scale-100 rotate-0'
                                  }`}
                                  fill="none"
                                  viewBox="0 0 24 24"
                                  stroke="currentColor"
                                >
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                {/* Stop Icon */}
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  className={`absolute inset-0 h-4 w-4 transition-all duration-300 ease-in-out ${
                                    isThisAudioActive
                                      ? 'opacity-100 scale-100 rotate-0'
                                      : 'opacity-0 scale-0 -rotate-90'
                                  }`}
                                  fill="none"
                                  viewBox="0 0 24 24"
                                  stroke="currentColor"
                                >
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9h6v6H9z" />
                                </svg>
                              </div>
                            )}
                          </button>
                        );
                      })()}
                    </div>
                  )}
                </div>

                {/* Chat Thread */}
                {item.chatHistory && item.chatHistory.length > 0 && (
                  <div className="mt-6 space-y-3 md:space-y-4 border-t border-stone-200 pt-5">
                    <h4 className="text-[10px] md:text-xs text-stone-600 font-bold uppercase tracking-widest mb-2 px-1">Follow-up Conversation</h4>
                    <div className="space-y-2 md:space-y-3">
                      {item.chatHistory.map((chat, idx) => (
                        <div key={idx} className={`flex flex-col ${chat.role === 'model' ? 'items-start' : 'items-end'}`}>
                          <div className={`px-4 md:px-5 py-3 rounded-xl md:rounded-2xl text-sm md:text-base leading-relaxed ${chat.role === 'model' ? 'bg-emerald-50 text-emerald-900 font-serif italic border border-emerald-200/50 shadow-sm' : 'bg-stone-100 text-stone-800 border border-stone-200 shadow-sm'}`}>
                            {chat.role === 'model' ? <ReactMarkdown>{chat.text}</ReactMarkdown> : <span className="whitespace-pre-wrap">{chat.text}</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </article>
            );
          })}
          </div>

          {hasMore && (
            <div className="mt-12 md:mt-16 flex justify-center">
              <button
                onClick={handleLoadMore}
                disabled={isLoadingMore}
                className="px-6 py-3 rounded-full bg-stone-100 hover:bg-stone-200 text-stone-700 font-medium text-sm md:text-base transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {isLoadingMore ? (
                  <>
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Loading...
                  </>
                ) : (
                  <>
                    Load More
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </>
                )}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};
