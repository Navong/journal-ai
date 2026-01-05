'use client';

import React from 'react';

interface MapViewProps {
  currentChapter: string;
  narrative: string;
}

export function MapView({ currentChapter, narrative }: MapViewProps) {
  return (
    <div className="flex flex-col h-full bg-[#FDFCF8] overflow-y-auto pb-20">
      <div className="flex-1 px-6 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center space-x-3 mb-6">
          <svg className="w-8 h-8 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path d="M12 2v20M12 2c-3 3-7 5-10 6v11c3-1 7-3 10-6M12 2c3 3 7 5 10 6v11c-3-1-7-3-10-6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <h1 className="text-3xl font-bold text-stone-900">Soul Map</h1>
        </div>

        {/* Current Chapter Card */}
        {currentChapter && narrative ? (
          <div className="bg-gradient-to-br from-indigo-600 to-indigo-800 rounded-3xl p-8 shadow-lg">
            <div className="flex items-center space-x-2 mb-4">
              <svg className="w-6 h-6 text-indigo-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span className="text-sm font-semibold text-indigo-200 uppercase tracking-wider">
                The Current Chapter
              </span>
            </div>

            <h2 className="text-2xl font-bold text-white mb-4 italic">
              &quot;{currentChapter}&quot;
            </h2>

            <p className="text-base text-indigo-100 leading-relaxed">
              {narrative}
            </p>
          </div>
        ) : (
          <div className="bg-gradient-to-br from-indigo-600 to-indigo-800 rounded-3xl p-8 shadow-lg text-center">
            <svg className="w-16 h-16 text-indigo-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <h2 className="text-xl font-semibold text-white mb-2">No Active Chapter</h2>
            <p className="text-indigo-200">Start journaling to begin your story</p>
          </div>
        )}

        {/* Journey Insights - Placeholder for future features */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-stone-900">Journey Insights</h3>

          <div className="bg-white rounded-2xl p-6 shadow-sm border border-stone-100">
            <div className="flex items-center space-x-3 mb-2">
              <div className="w-10 h-10 bg-emerald-100 rounded-full flex items-center justify-center">
                <svg className="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <div>
                <h4 className="font-semibold text-stone-900">Growth Moments</h4>
                <p className="text-sm text-stone-500">Track your progress and wins</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl p-6 shadow-sm border border-stone-100">
            <div className="flex items-center space-x-3 mb-2">
              <div className="w-10 h-10 bg-rose-100 rounded-full flex items-center justify-center">
                <svg className="w-5 h-5 text-rose-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <div>
                <h4 className="font-semibold text-stone-900">Connections</h4>
                <p className="text-sm text-stone-500">People who matter in your journey</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl p-6 shadow-sm border border-stone-100">
            <div className="flex items-center space-x-3 mb-2">
              <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center">
                <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <div>
                <h4 className="font-semibold text-stone-900">Themes</h4>
                <p className="text-sm text-stone-500">Recurring patterns and topics</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
