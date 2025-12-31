
import React from 'react';
import ReactMarkdown from 'react-markdown';
import { Reflection } from '../types';

interface ReflectionCardProps {
  reflection: Reflection | null;
  isLoading: boolean;
  onTogglePlayback?: () => void;
  isPlaying?: boolean;
  isGeneratingVoice?: boolean;
}

export const ReflectionCard: React.FC<ReflectionCardProps> = ({ reflection, isLoading, onTogglePlayback, isPlaying, isGeneratingVoice }) => {
  if (!reflection && !isLoading) return null;

  return (
    <div className="mt-8 md:mt-12 transition-all duration-700 ease-in-out">
      <div className={`
        relative p-6 md:p-8 rounded-2xl md:rounded-3xl border border-stone-100 shadow-sm
        ${isLoading ? 'bg-stone-50 animate-pulse' : 'bg-[#F2F6F3]'} 
        text-stone-800 leading-relaxed
      `}>
        {/* Companion Icon */}
        <div className="absolute -top-5 left-6 md:-top-6 md:left-10 w-10 h-10 md:w-12 md:h-12 bg-emerald-100 rounded-full flex items-center justify-center shadow-sm z-10">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 md:h-6 md:w-6 text-emerald-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
          </svg>
        </div>

        {/* Speaker / Playback Control */}
        {!isLoading && reflection && onTogglePlayback && (
          <button 
            onClick={onTogglePlayback}
            disabled={isGeneratingVoice}
            className={`absolute top-3 right-3 md:top-4 md:right-4 transition-all p-2.5 md:p-2 rounded-full active:scale-90 ${isGeneratingVoice ? 'bg-stone-100 text-stone-300' : isPlaying ? 'text-emerald-600 bg-emerald-50' : 'text-stone-400 hover:text-emerald-600 hover:bg-stone-100'}`}
            title={isGeneratingVoice ? "Generating..." : isPlaying ? "Stop" : "Listen"}
          >
            {isGeneratingVoice ? (
              <svg className="animate-spin h-5 w-5 md:h-6 md:w-6" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            ) : isPlaying ? (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 md:h-6 md:w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 md:h-6 md:w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
              </svg>
            )}
          </button>
        )}

        <div className="pt-5 md:pt-4 space-y-4">
          {isLoading ? (
            <div className="space-y-3">
              <div className="h-3.5 bg-stone-200 rounded w-3/4"></div>
              <div className="h-3.5 bg-stone-200 rounded w-full"></div>
              <div className="h-3.5 bg-stone-200 rounded w-5/6"></div>
            </div>
          ) : (
            <div className="prose prose-stone prose-sm sm:prose-base font-serif italic text-stone-700 leading-relaxed">
              <ReactMarkdown>{reflection?.content || ''}</ReactMarkdown>
            </div>
          )}
        </div>
        
        {!isLoading && reflection && (
          <div className="mt-5 md:mt-6 text-[9px] md:text-xs text-stone-400 font-medium tracking-wide uppercase">
            A reflection from your companion
          </div>
        )}
      </div>
    </div>
  );
};
