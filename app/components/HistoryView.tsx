'use client';

import React, { useState } from 'react';
import { HistoryEntry } from '../types';
import ReactMarkdown from 'react-markdown';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import Link from 'next/link';

interface HistoryViewProps {
  history: HistoryEntry[];
  onBack: () => void;
  onDeleteEntry?: (id: string) => void;
  onClearAll?: () => void;
  onPlayAudio?: (text: string, id: string) => void;
  onStopAudio?: () => void;
  activeAudioId?: string | number | null;
  isPlaying?: boolean;
  isPaused?: boolean;
  isGeneratingVoice?: boolean;
  generatingAudioId?: string | number | null;
}

export const HistoryView: React.FC<HistoryViewProps> = ({
  history,
  onBack,
  onDeleteEntry,
  onClearAll,
  onPlayAudio,
  onStopAudio,
  activeAudioId,
  isPlaying = false,
  isPaused = false,
  isGeneratingVoice = false,
  generatingAudioId
}) => {
  const [expandedEntries, setExpandedEntries] = useState<Set<string>>(new Set());
  const [deleteDialogId, setDeleteDialogId] = useState<string | null>(null);
  const [showClearAllDialog, setShowClearAllDialog] = useState(false);

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

  return (
    <div className="flex flex-col animate-in fade-in duration-500">
      <div className="flex items-center justify-between mb-8 md:mb-12">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-stone-500 hover:text-stone-800 transition-colors group text-sm md:text-base"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 md:h-5 md:w-5 transition-transform group-hover:-translate-x-1" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M7.707 14.707a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l2.293 2.293a1 1 0 010 1.414z" clipRule="evenodd" />
          </svg>
          Back
        </button>

        <div className="flex items-center gap-3">
          <Link
            href="/migrate-audio"
            className="text-stone-400 hover:text-emerald-600 text-[10px] md:text-xs tracking-widest uppercase transition-colors px-2 py-1"
            title="Migrate audio files to database"
          >
            Migrate Audio
          </Link>

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
        <div className="space-y-12 md:space-y-16">
          {history.map((item) => {
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

                {/* Journal Entry with Truncation */}
                <div className="mb-5 md:mb-6 relative">
                  <div className={`
                    text-stone-800 font-serif leading-relaxed whitespace-pre-wrap text-base md:text-lg transition-all duration-300
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
                <div className="bg-[#F2F6F3] p-4 md:p-6 rounded-xl md:rounded-2xl border border-emerald-100/50 text-stone-800 italic font-serif text-sm md:text-base leading-relaxed mb-4 relative shadow-sm">
                  {/* Audio Playback Button */}
                  {onPlayAudio && (
                    <button
                      onClick={() => {
                        const audioId = `history-${item.id}`;

                        // If this audio is currently playing, stop it
                        if (isPlaying && activeAudioId === audioId) {
                          if (onStopAudio) {
                            onStopAudio();
                          }
                          return;
                        }

                        // Always pass reflection text - audio is stored in IndexedDB cache
                        // The handler will check cache first, then generate if needed
                        onPlayAudio(item.reflection, audioId);
                      }}
                      disabled={isGeneratingVoice && generatingAudioId === `history-${item.id}`}
                      className={`
                        absolute top-3 right-3 transition-all p-2 rounded-full active:scale-90
                        ${isGeneratingVoice && generatingAudioId === `history-${item.id}`
                          ? 'bg-stone-100 text-stone-300 cursor-wait'
                          : isPlaying && activeAudioId === `history-${item.id}`
                            ? isPaused
                              ? 'text-emerald-600 bg-emerald-50 hover:bg-emerald-100'
                              : 'text-emerald-600 bg-emerald-100'
                            : 'text-stone-400 hover:text-emerald-600 hover:bg-stone-100'
                        }
                      `}
                      title={
                        isGeneratingVoice && generatingAudioId === `history-${item.id}`
                          ? 'Generating...'
                          : isPlaying && activeAudioId === `history-${item.id}`
                            ? isPaused
                              ? 'Resume'
                              : 'Playing'
                            : 'Listen to reflection'
                      }
                    >
                      {isGeneratingVoice && generatingAudioId === `history-${item.id}` ? (
                        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                      ) : isPlaying && activeAudioId === `history-${item.id}` ? (
                        isPaused ? (
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        ) : (
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        )
                      ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                        </svg>
                      )}
                    </button>
                  )}
                  <ReactMarkdown>{item.reflection}</ReactMarkdown>
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
      )}
    </div>
  );
};
