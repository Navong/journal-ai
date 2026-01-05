'use client';

import React from 'react';
import { Mood } from '../types';

interface TodayViewProps {
  currentChapter: string;
  narrative: string;
  selectedMood: Mood | null;
  onMoodSelect: (mood: Mood) => void;
  onContinueStory: () => void;
}

const emotions: { label: string; value: Mood; icon: React.ReactNode; color: string }[] = [
  {
    label: 'PEACEFUL',
    value: 'calm',
    color: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    icon: (
      <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10" strokeWidth="2"/>
        <path d="M8 14s1.5 2 4 2 4-2 4-2" strokeWidth="2" strokeLinecap="round"/>
        <line x1="9" y1="9" x2="9.01" y2="9" strokeWidth="2" strokeLinecap="round"/>
        <line x1="15" y1="9" x2="15.01" y2="9" strokeWidth="2" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    label: 'GRATEFUL',
    value: 'joyful',
    color: 'bg-rose-50 text-rose-700 border-rose-200',
    icon: (
      <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    label: 'ANXIOUS',
    value: 'anxious',
    color: 'bg-amber-50 text-amber-700 border-amber-200',
    icon: (
      <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
  },
  {
    label: 'PRODUCTIVE',
    value: 'reflective',
    color: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    icon: (
      <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10" strokeWidth="2"/>
        <circle cx="12" cy="12" r="6" strokeWidth="2"/>
        <circle cx="12" cy="12" r="2" strokeWidth="2"/>
      </svg>
    ),
  },
];

export function TodayView({
  currentChapter,
  narrative,
  selectedMood,
  onMoodSelect,
  onContinueStory,
}: TodayViewProps) {
  return (
    <div className="flex flex-col h-full bg-[#FDFCF8] overflow-y-auto pb-20">
      <div className="flex-1 px-6 py-6 space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-4xl font-bold text-stone-900 mb-3">SoulReflect</h1>
          {currentChapter && (
            <div className="flex items-start space-x-2 text-indigo-600">
              <svg className="w-5 h-5 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <p className="text-base font-medium italic">&quot;{currentChapter}&quot;</p>
            </div>
          )}
        </div>

        {/* Narrative Section */}
        {narrative && (
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-stone-100">
            <div className="flex items-center space-x-2 mb-4">
              <svg className="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <h2 className="text-sm font-semibold text-indigo-600 uppercase tracking-wider">The Narrative So Far</h2>
            </div>
            <p className="text-base text-stone-700 leading-relaxed italic">&quot;{narrative}&quot;</p>
          </div>
        )}

        {/* Emotion Buttons */}
        <div className="grid grid-cols-2 gap-3">
          {emotions.map((emotion) => (
            <button
              key={emotion.value}
              onClick={() => onMoodSelect(emotion.value)}
              className={`flex flex-col items-center justify-center p-6 rounded-2xl border-2 transition-all touch-manipulation ${
                selectedMood === emotion.value
                  ? emotion.color + ' shadow-md scale-105'
                  : 'bg-white border-stone-200 text-stone-400 hover:border-stone-300 hover:text-stone-600'
              }`}
            >
              {emotion.icon}
              <span className="mt-3 text-sm font-medium">{emotion.label}</span>
            </button>
          ))}
        </div>

        {/* Continue Story Section */}
        <div className="bg-slate-900 rounded-3xl p-8 text-center">
          <button
            onClick={onContinueStory}
            className="flex flex-col items-center justify-center w-full touch-manipulation group"
          >
            <div className="w-12 h-12 bg-slate-800 rounded-full flex items-center justify-center mb-4 group-hover:bg-slate-700 transition-colors">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <line x1="12" y1="5" x2="12" y2="19" strokeWidth="2" strokeLinecap="round"/>
                <line x1="5" y1="12" x2="19" y2="12" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </div>
            <h3 className="text-xl font-semibold text-white mb-1">Continue your story</h3>
            <p className="text-sm text-stone-400">AI Context Link Active</p>
          </button>
        </div>
      </div>
    </div>
  );
}
