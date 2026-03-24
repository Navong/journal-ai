'use client';

import React from 'react';
import ReactMarkdown from 'react-markdown';
import { Reflection } from '../types';
import { HighlightedText } from './HighlightedText';

interface ReflectionCardProps {
  reflection: Reflection | null;
  isLoading: boolean;
}

export const ReflectionCard: React.FC<ReflectionCardProps> = ({
  reflection,
  isLoading,
}) => {
  if (!reflection && !isLoading) return null;

  return (
    <div className="mt-6 md:mt-12 transition-all duration-700 ease-in-out">
      <div className={`
        relative p-4 md:p-8 rounded-xl md:rounded-3xl border border-stone-100 shadow-sm
        ${isLoading ? 'bg-stone-50 animate-pulse' : 'bg-[#F2F6F3]'} 
        text-stone-800 leading-relaxed
      `}>
        {/* Companion Icon */}
        <div className="absolute -top-4 left-4 md:-top-6 md:left-10 w-9 h-9 md:w-12 md:h-12 bg-emerald-100 rounded-full flex items-center justify-center shadow-sm z-10">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 md:h-6 md:w-6 text-emerald-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
          </svg>
        </div>

        <div className="pt-4 md:pt-4 space-y-3 md:space-y-4">
          {isLoading ? (
            <div className="space-y-3">
              <div className="h-3.5 bg-stone-200 rounded w-3/4"></div>
              <div className="h-3.5 bg-stone-200 rounded w-full"></div>
              <div className="h-3.5 bg-stone-200 rounded w-5/6"></div>
            </div>
          ) : (
            <div className="text-stone-800 font-serif text-base sm:text-lg leading-relaxed" style={{ fontFamily: 'var(--font-lora), serif' }}>
              <HighlightedText 
                content={reflection?.content || ''} 
                highlights={reflection?.highlights}
              />
            </div>
          )}
        </div>

        {!isLoading && reflection && (
          <div className="mt-4 md:mt-6">
            <div className="text-[9px] md:text-xs text-stone-400 font-medium tracking-wide uppercase">
              A reflection from your companion
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
