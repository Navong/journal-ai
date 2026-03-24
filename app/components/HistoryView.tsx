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
}

const ITEMS_PER_PAGE = 5;

export const HistoryView: React.FC<HistoryViewProps> = ({
  history,
  onBack,
  onDeleteEntry,
  onClearAll,
}) => {
  const [expandedEntries, setExpandedEntries] = useState<Set<string>>(new Set());
  const [deleteDialogId, setDeleteDialogId] = useState<string | null>(null);
  const [showClearAllDialog, setShowClearAllDialog] = useState(false);
  const [displayedHistory, setDisplayedHistory] = useState<HistoryEntry[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);

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
      if (displayedHistory.length < history.length) {
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
          className="flex items-center gap-1.5 transition-colors group text-sm md:text-base touch-manipulation min-h-[44px] md:min-h-0 px-2 -ml-2 md:ml-0"
          style={{ color: '#A89E92' }}
          onMouseEnter={e => (e.currentTarget.style.color = '#5C4F3D')}
          onMouseLeave={e => (e.currentTarget.style.color = '#A89E92')}
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
                  style={{
                    color: '#A89E92',
                    fontSize: 10,
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    fontFamily: "'Helvetica Neue', sans-serif",
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: '4px 8px',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.color = '#9B3A3A')}
                  onMouseLeave={e => (e.currentTarget.style.color = '#A89E92')}
                >
                  Clear All
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
                    Clear All History?
                  </AlertDialog.Title>
                  <AlertDialog.Description style={{ color: '#7A6E60', marginBottom: 24, fontSize: 14, lineHeight: 1.6 }}>
                    This will permanently delete all {history.length} {history.length === 1 ? 'entry' : 'entries'}. This action cannot be undone.
                  </AlertDialog.Description>
                  <div className="flex gap-3 justify-end">
                    <AlertDialog.Cancel asChild>
                      <button style={{ padding: '8px 16px', borderRadius: 20, color: '#7A6E60', background: 'none', border: '1px solid #E0D8CE', cursor: 'pointer', fontSize: 13 }}>
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
                        style={{ padding: '8px 16px', borderRadius: 20, background: '#9B3A3A', color: '#FDFCF8', border: 'none', cursor: 'pointer', fontSize: 13 }}
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

      <h2 style={{ fontSize: 24, fontWeight: 400, color: '#2C2825', letterSpacing: '-0.01em', fontFamily: 'Georgia, serif', marginBottom: 32, paddingLeft: 4 }}>Past Reflections</h2>

      {history.length === 0 ? (
        <div style={{ padding: '80px 0', textAlign: 'center', color: '#C4BAB0', fontStyle: 'italic', fontSize: 14 }}>
          No past reflections yet.
        </div>
      ) : (
        <>
          <div className="space-y-12 md:space-y-16">
            {displayedHistory.map((item) => {
            const isExpanded = expandedEntries.has(item.id);
            const isLongEntry = item.text.length > 250 || (item.text.match(/\n/g) || []).length > 2;

            return (
              <article key={item.id} className="relative group" style={{ borderLeft: '2px solid #E0D8CE', paddingLeft: 24 }}>
                <div style={{ position: 'absolute', left: -5, top: 6, width: 8, height: 8, borderRadius: '50%', background: '#C4BAB0' }}></div>

                {/* Delete Button */}
                {onDeleteEntry && (
                  <AlertDialog.Root open={deleteDialogId === item.id} onOpenChange={(open) => !open && setDeleteDialogId(null)}>
                    <AlertDialog.Trigger asChild>
                      <button
                        onClick={() => setDeleteDialogId(item.id)}
                        className="absolute top-0 right-0 opacity-0 group-hover:opacity-100 transition-opacity active:scale-90"
                        style={{ padding: 8, borderRadius: '50%', color: '#C4BAB0', background: 'none', border: 'none', cursor: 'pointer' }}
                        onMouseEnter={e => (e.currentTarget.style.color = '#9B3A3A')}
                        onMouseLeave={e => (e.currentTarget.style.color = '#C4BAB0')}
                        title="Delete entry"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 md:h-5 md:w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
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
                          Delete Entry?
                        </AlertDialog.Title>
                        <AlertDialog.Description style={{ color: '#7A6E60', marginBottom: 24, fontSize: 14, lineHeight: 1.6 }}>
                          This action cannot be undone. The entry will be permanently deleted from your history.
                        </AlertDialog.Description>
                        <div className="flex gap-3 justify-end">
                          <AlertDialog.Cancel asChild>
                            <button style={{ padding: '8px 16px', borderRadius: 20, color: '#7A6E60', background: 'none', border: '1px solid #E0D8CE', cursor: 'pointer', fontSize: 13 }}>
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
                              style={{ padding: '8px 16px', borderRadius: 20, background: '#9B3A3A', color: '#FDFCF8', border: 'none', cursor: 'pointer', fontSize: 13 }}
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
                  <time style={{ fontSize: 11, color: '#A89E92', fontFamily: "'Helvetica Neue', sans-serif", textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                    {formatDate(item.timestamp)}
                  </time>
                </div>

                {/* Essence Summary */}
                {item.summary && (
                  <div className="mb-3 md:mb-4">
                    <p style={{ fontSize: 15, color: '#3A3530', lineHeight: 1.4, borderBottom: '1px solid #E8E4DD', paddingBottom: 10 }}>
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
                    font-serif leading-relaxed whitespace-pre-wrap text-sm md:text-base transition-all duration-300
                    ${!isExpanded && isLongEntry ? 'line-clamp-3 overflow-hidden mask-fade-bottom' : ''}
                  `} style={{ color: '#5C4F3D' }}>
                    {item.text}
                  </div>

                  {isLongEntry && (
                    <button
                      onClick={() => toggleExpand(item.id)}
                      style={{ marginTop: 12, fontSize: 11, color: '#A89E92', textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: "'Helvetica Neue', sans-serif", background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, padding: '6px 0' }}
                      onMouseEnter={e => (e.currentTarget.style.color = '#5C4F3D')}
                      onMouseLeave={e => (e.currentTarget.style.color = '#A89E92')}
                    >
                      {isExpanded ? (
                        <>Show less <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" /></svg></>
                      ) : (
                        <>Read more <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg></>
                      )}
                    </button>
                  )}
                </div>

                {/* Reflection Card */}
                <div style={{ background: '#F4F1EB', borderLeft: '3px solid #B5A47A', borderRadius: 4, padding: '16px 24px', marginBottom: 12 }}>
                  <div style={{ fontFamily: 'Georgia, serif', fontSize: 14, lineHeight: 1.75, color: '#4A4238', fontStyle: 'italic' }}>
                    <HighlightedText
                      content={item.reflection}
                      highlights={item.highlights}
                    />
                  </div>
                </div>

                {/* Chat Thread */}
                {item.chatHistory && item.chatHistory.length > 0 && (
                  <div className="mt-6 space-y-3 md:space-y-4" style={{ borderTop: '1px solid #E8E4DD', paddingTop: 20 }}>
                    <h4 style={{ fontSize: 10, color: '#A89E92', textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: "'Helvetica Neue', sans-serif", marginBottom: 8, fontWeight: 400 }}>Follow-up Conversation</h4>
                    <div className="space-y-2 md:space-y-3">
                      {item.chatHistory.map((chat, idx) => (
                        <div key={idx} className={`flex flex-col ${chat.role === 'model' ? 'items-start' : 'items-end'}`}>
                          <div style={{
                            padding: '10px 16px',
                            borderRadius: chat.role === 'model' ? '12px 12px 12px 4px' : '12px 12px 4px 12px',
                            fontSize: 13,
                            lineHeight: 1.6,
                            ...(chat.role === 'model' ? {
                              background: '#F4F1EB',
                              color: '#4A4238',
                              fontStyle: 'italic',
                              fontFamily: 'Georgia, serif',
                            } : {
                              background: '#E8E4DD',
                              color: '#3A3530',
                              fontFamily: "'Helvetica Neue', sans-serif",
                            }),
                          }}>
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
                style={{
                  padding: '12px 28px',
                  background: '#E8E4DD',
                  color: '#5C4F3D',
                  borderRadius: 3,
                  border: 'none',
                  cursor: isLoadingMore ? 'not-allowed' : 'pointer',
                  fontSize: 12,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  fontFamily: "'Helvetica Neue', sans-serif",
                  opacity: isLoadingMore ? 0.5 : 1,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  transition: 'background 0.2s',
                }}
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
