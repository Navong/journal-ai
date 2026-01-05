'use client';

import React, { useState } from 'react';
import { HistoryEntry, Mood } from '../types';

interface StoryViewProps {
  history: HistoryEntry[];
  onPlayAudio?: (text: string, entryId: string) => void;
  onDeleteEntry?: (entryId: string) => void;
}

const moodColors: Record<Mood, { bg: string; text: string; label: string }> = {
  calm: { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'Peaceful' },
  joyful: { bg: 'bg-rose-100', text: 'text-rose-700', label: 'Grateful' },
  anxious: { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Anxious' },
  reflective: { bg: 'bg-indigo-100', text: 'text-indigo-700', label: 'Productive' },
  heavy: { bg: 'bg-stone-100', text: 'text-stone-700', label: 'Heavy' },
  tired: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Tired' },
  none: { bg: 'bg-stone-100', text: 'text-stone-700', label: 'Neutral' },
};

export function StoryView({ history, onPlayAudio, onDeleteEntry }: StoryViewProps) {
  const [expandedEntry, setExpandedEntry] = useState<string | null>(null);

  const formatDate = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' });
  };

  const toggleExpand = (entryId: string) => {
    setExpandedEntry(expandedEntry === entryId ? null : entryId);
  };

  return (
    <div className="flex flex-col h-full bg-[#FDFCF8] overflow-y-auto pb-20">
      <div className="flex-1 px-6 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center space-x-3 mb-6">
          <svg className="w-8 h-8 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" strokeWidth="2"/>
            <polyline points="12 6 12 12 16 14" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <h1 className="text-3xl font-bold text-stone-900">Your Timeline</h1>
        </div>

        {/* Timeline Entries */}
        {history.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-stone-400 text-lg">No entries yet. Start your journey today.</p>
          </div>
        ) : (
          <div className="space-y-6 relative">
            {/* Timeline line */}
            <div className="absolute left-6 top-0 bottom-0 w-0.5 bg-stone-200" />

            {history.map((entry, index) => {
              const isExpanded = expandedEntry === entry.id;
              const moodStyle = moodColors[entry.mood] || moodColors.none;

              return (
                <div key={entry.id} className="relative pl-16">
                  {/* Timeline dot */}
                  <div className="absolute left-4 top-8 w-5 h-5 bg-indigo-600 rounded-full border-4 border-[#FDFCF8]" />

                  <div className="bg-white rounded-2xl shadow-sm border border-stone-100 overflow-hidden">
                    {/* Entry Header */}
                    <div className="p-6">
                      <div className="flex items-center justify-between mb-4">
                        <span className="text-lg font-medium text-stone-400">
                          {formatDate(entry.timestamp)}
                        </span>
                        <span className={`px-4 py-1.5 rounded-full text-sm font-medium ${moodStyle.bg} ${moodStyle.text}`}>
                          {moodStyle.label}
                        </span>
                      </div>

                      {/* Entry Text */}
                      <p className="text-base text-stone-700 leading-relaxed mb-4">
                        {isExpanded ? entry.text : `${entry.text.substring(0, 150)}${entry.text.length > 150 ? '...' : ''}`}
                      </p>

                      {entry.text.length > 150 && (
                        <button
                          onClick={() => toggleExpand(entry.id)}
                          className="text-indigo-600 text-sm font-medium hover:text-indigo-700 transition-colors"
                        >
                          {isExpanded ? 'Show less' : 'Read more'}
                        </button>
                      )}
                    </div>

                    {/* AI Reflection Section */}
                    {entry.reflection && (
                      <div className="bg-indigo-50 px-6 py-5 border-t border-indigo-100">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center space-x-2">
                            <svg className="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                            <span className="text-sm font-semibold text-indigo-600 uppercase tracking-wider">
                              AI Reflection
                            </span>
                          </div>
                          {onPlayAudio && (
                            <button
                              onClick={() => onPlayAudio(entry.reflection, entry.id)}
                              className="text-indigo-600 hover:text-indigo-700 transition-colors touch-manipulation"
                              aria-label="Play audio reflection"
                            >
                              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path d="M15.536 8.464a5 5 0 0 1 0 7.072m2.828-9.9a9 9 0 0 1 0 12.728M5.586 15.586a2 2 0 0 0 2.828 0L12 12l-3.586-3.586a2 2 0 0 0-2.828 0L2 12l3.586 3.586zm7.07-7.07L9.071 12l3.585 3.586" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            </button>
                          )}
                        </div>
                        <p className="text-base text-indigo-900 leading-relaxed italic">
                          &quot;{entry.reflection}&quot;
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
