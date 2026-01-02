'use client';

import React from 'react';
import ReactMarkdown from 'react-markdown';
import { Reflection } from '../types';

interface ReflectionCardProps {
  reflection: Reflection | null;
  isLoading: boolean;
  onPlay?: () => void;
  onPause?: () => void;
  onStop?: () => void;
  isPlaying?: boolean;
  isPaused?: boolean;
  isGeneratingVoice?: boolean;
  playbackRate?: number;
  onPlaybackRateChange?: (rate: number) => void;
}

export const ReflectionCard: React.FC<ReflectionCardProps> = ({
  reflection,
  isLoading,
  onPlay,
  onPause,
  onStop,
  isPlaying,
  isPaused,
  isGeneratingVoice,
  playbackRate = 1.0,
  onPlaybackRateChange
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
            <div className="prose prose-stone prose-sm sm:prose-base font-serif italic text-stone-700 leading-relaxed" style={{ fontFamily: 'var(--font-lora), serif' }}>
              <ReactMarkdown>{reflection?.content || ''}</ReactMarkdown>
            </div>
          )}
        </div>

        {!isLoading && reflection && (
          <div className="mt-4 md:mt-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="text-[9px] md:text-xs text-stone-400 font-medium tracking-wide uppercase">
              A reflection from your companion
            </div>
            {/* Playback Controls */}
            {(onPlay || onPause || onStop) && (
              <div className="flex items-center gap-2 flex-shrink-0">
                {isPlaying && (
                  <div className="flex items-center gap-1 bg-white/80 backdrop-blur-sm rounded-full px-2 py-1 shadow-sm border border-stone-200">
                    <button
                      onClick={() => onPlaybackRateChange?.(Math.max(0.5, playbackRate - 0.25))}
                      className="text-[10px] text-stone-600 hover:text-emerald-600 px-1"
                      title="Slower"
                    >
                      −
                    </button>
                    <span className="text-[10px] font-medium text-stone-700 min-w-[2.5rem] text-center">
                      {playbackRate.toFixed(2)}×
                    </span>
                    <button
                      onClick={() => onPlaybackRateChange?.(Math.min(2.0, playbackRate + 0.25))}
                      className="text-[10px] text-stone-600 hover:text-emerald-600 px-1"
                      title="Faster"
                    >
                      +
                    </button>
                  </div>
                )}
                
                {/* Play Button */}
                {onPlay && (
                  <button
                    onClick={onPlay}
                    disabled={isGeneratingVoice || (isPlaying && !isPaused)}
                    className={`transition-all p-2.5 md:p-2 rounded-full active:scale-90 touch-manipulation min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0 flex items-center justify-center ${
                      isGeneratingVoice || (isPlaying && !isPaused)
                        ? 'bg-stone-100 text-stone-300 cursor-not-allowed opacity-50'
                        : 'text-emerald-600 bg-emerald-50 hover:bg-emerald-100'
                    }`}
                    title={isGeneratingVoice ? "Generating..." : "Play"}
                  >
                    {isGeneratingVoice ? (
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                    ) : (
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    )}
                  </button>
                )}

                {/* Pause Button */}
                {onPause && (
                  <button
                    onClick={onPause}
                    disabled={!isPlaying || isPaused || isGeneratingVoice}
                    className={`transition-all p-2.5 md:p-2 rounded-full active:scale-90 touch-manipulation min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0 flex items-center justify-center ${
                      !isPlaying || isPaused || isGeneratingVoice
                        ? 'bg-stone-100 text-stone-300 cursor-not-allowed opacity-50'
                        : 'text-emerald-600 bg-emerald-50 hover:bg-emerald-100'
                    }`}
                    title="Pause"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </button>
                )}

                {/* Stop Button */}
                {onStop && (
                  <button
                    onClick={onStop}
                    disabled={!isPlaying && !isPaused || isGeneratingVoice}
                    className={`transition-all p-2.5 md:p-2 rounded-full active:scale-90 touch-manipulation min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0 flex items-center justify-center ${
                      (!isPlaying && !isPaused) || isGeneratingVoice
                        ? 'bg-stone-100 text-stone-300 cursor-not-allowed opacity-50'
                        : 'text-rose-600 bg-rose-50 hover:bg-rose-100'
                    }`}
                    title="Stop"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10h6v4H9z" />
                    </svg>
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
