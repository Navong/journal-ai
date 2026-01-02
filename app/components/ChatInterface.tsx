'use client';

import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { ChatMessage } from '../types';

interface ChatInterfaceProps {
  messages: ChatMessage[];
  onSendMessage: (text: string) => void;
  isSending: boolean;
  onClose: () => void;
  onTogglePlayback?: (text: string, index: number) => void;
  activeAudioId?: string | number | null;
  generatingAudioId?: string | number | null;
  contextRevalidated?: boolean;
}

export const ChatInterface: React.FC<ChatInterfaceProps> = ({
  messages,
  onSendMessage,
  isSending,
  onClose,
  onTogglePlayback,
  activeAudioId,
  generatingAudioId,
  contextRevalidated = false
}) => {
  const [inputText, setInputText] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (messages.length > 0 || isSending) {
      scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isSending]);

  // Handle escape key to close
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || isSending) return;
    onSendMessage(inputText);
    setInputText('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 md:p-6 animate-in fade-in duration-300">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm cursor-pointer"
        onClick={onClose}
      />

      {/* Modal Container */}
      <div
        ref={containerRef}
        className="relative w-full max-w-2xl bg-[#FDFCF8] h-[95vh] sm:h-[85vh] flex flex-col rounded-t-[2rem] sm:rounded-[2.5rem] shadow-2xl border border-stone-100 overflow-hidden animate-in slide-in-from-bottom-10 duration-500"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 md:px-8 py-4 md:py-6 border-b border-stone-100 bg-white/50 backdrop-blur-md sticky top-0 z-10">
          <div className="flex items-center gap-3 md:gap-4">
            <div className="w-8 h-8 md:w-10 md:h-10 bg-emerald-50 rounded-full flex items-center justify-center border border-emerald-100/50">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 md:h-5 md:w-5 text-emerald-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <div className="flex-1">
              <h3 className="text-[10px] md:text-xs font-bold text-stone-400 uppercase tracking-widest">Conversation</h3>
              <div className="flex items-center gap-2 mt-0.5">
              <p className="text-[9px] md:text-[10px] text-emerald-600 font-medium tracking-wide uppercase">Refining Insights</p>
                {contextRevalidated && (
                  <span className="flex items-center gap-1 text-[8px] md:text-[9px] text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full uppercase tracking-widest font-bold border border-emerald-100 animate-pulse">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Context Updated
                  </span>
                )}
              </div>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 md:w-10 md:h-10 rounded-full flex items-center justify-center text-stone-300 hover:text-stone-600 hover:bg-stone-100 transition-all active:scale-90"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 md:h-6 md:w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Messages Area */}
        <div className="flex-grow overflow-y-auto px-6 md:px-8 py-6 md:py-10 space-y-8 md:space-y-10 scrollbar-hide">
          {messages.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-center px-6 md:px-10">
              <div className="w-12 h-12 md:w-16 md:h-16 bg-emerald-50 rounded-full flex items-center justify-center mb-4 md:mb-6 opacity-40">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 md:h-8 md:w-8 text-emerald-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z" />
                </svg>
              </div>
              <p className="text-stone-400 italic font-serif text-base md:text-lg leading-relaxed">
                "Every conversation is a bridge to clarity."<br />
                <span className="text-[10px] font-sans not-italic uppercase tracking-widest mt-4 inline-block opacity-60">Ask anything about your thoughts.</span>
              </p>
            </div>
          )}

          {messages.map((msg, i) => {
            const id = `chat-${i}`;
            const isPlaying = activeAudioId === id;
            const isGenerating = generatingAudioId === id;
            const isModel = msg.role === 'model';

            return (
              <div
                key={i}
                className={`flex flex-col ${isModel ? 'items-start' : 'items-end'} animate-in fade-in duration-500`}
              >
                <div className={`flex max-w-[95%] md:max-w-[85%] group ${isModel ? 'flex-row' : 'flex-row-reverse'} items-end gap-2 md:gap-3`}>
                  {isModel && (
                    <div className="flex-shrink-0 flex flex-col items-center gap-2 mb-2">
                      <button
                        onClick={() => onTogglePlayback?.(msg.text, i)}
                        disabled={isGenerating}
                        className={`w-8 h-8 md:w-9 md:h-9 rounded-full flex items-center justify-center transition-all duration-300 active:scale-90 ${isGenerating
                          ? 'bg-stone-50 text-stone-300 cursor-wait'
                          : isPlaying
                            ? 'bg-emerald-100 text-emerald-700 shadow-inner'
                            : 'bg-stone-50 text-stone-300 hover:text-emerald-600 hover:bg-emerald-50'
                          }`}
                      >
                        {isGenerating ? (
                          <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                        ) : isPlaying ? (
                          <span className="flex gap-0.5">
                            <span className="w-0.5 h-2 bg-emerald-600 animate-[bounce_0.6s_infinite]"></span>
                            <span className="w-0.5 h-3 bg-emerald-600 animate-[bounce_0.8s_infinite]"></span>
                          </span>
                        ) : (
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 md:h-4 md:w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                          </svg>
                        )}
                      </button>
                    </div>
                  )}

                  <div className={`
                    relative px-4 md:px-6 py-3 md:py-4 rounded-2xl md:rounded-3xl text-sm md:text-base leading-relaxed transition-all
                    ${!isModel
                      ? 'bg-stone-100 text-stone-700 rounded-br-none border border-stone-200/50'
                      : 'bg-[#F2F6F3] text-stone-800 border border-emerald-100/50 rounded-bl-none shadow-sm'}
                  `}>
                    {isModel ? (
                      <div className="prose prose-stone prose-sm font-serif text-stone-800 leading-relaxed" style={{ fontFamily: 'var(--font-lora), serif' }}>
                        <ReactMarkdown>{msg.text}</ReactMarkdown>
                      </div>
                    ) : (
                      <div className="whitespace-pre-wrap">{msg.text}</div>
                    )}

                    {isPlaying && isModel && (
                      <div className="absolute -bottom-4 md:-bottom-5 left-0 flex items-center gap-1.5 opacity-60">
                        <span className="flex gap-0.5">
                          <span className="w-0.5 h-1 md:h-1.5 bg-emerald-400 animate-[bounce_0.6s_infinite]"></span>
                          <span className="w-0.5 h-1.5 md:h-2 bg-emerald-400 animate-[bounce_0.8s_infinite]"></span>
                        </span>
                        <span className="text-[8px] md:text-[9px] uppercase tracking-widest font-bold text-emerald-600">Speaking</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {isSending && (
            <div className="flex justify-start animate-pulse">
              <div className="bg-[#F2F6F3] px-5 py-3 rounded-2xl md:rounded-3xl rounded-bl-none border border-emerald-100 flex items-center gap-2 md:gap-3 ml-10 md:ml-12 shadow-sm">
                <div className="flex gap-1">
                  <span className="w-1 md:w-1.5 h-1 md:h-1.5 bg-emerald-300 rounded-full animate-bounce"></span>
                  <span className="w-1 md:w-1.5 h-1 md:h-1.5 bg-emerald-300 rounded-full animate-bounce [animation-delay:0.2s]"></span>
                  <span className="w-1 md:w-1.5 h-1 md:h-1.5 bg-emerald-300 rounded-full animate-bounce [animation-delay:0.4s]"></span>
                </div>
                <span className="text-[9px] md:text-[10px] text-emerald-400 font-medium uppercase tracking-widest">Serenity is reflecting</span>
              </div>
            </div>
          )}
          <div ref={scrollRef} className="h-6 md:h-8" />
        </div>

        {/* Input Area */}
        <div className="px-6 md:px-8 py-4 md:py-8 border-t border-stone-100 bg-white/50 backdrop-blur-md sticky-bottom-safe">
          <form onSubmit={handleSubmit} className="relative group max-w-xl mx-auto">
            <div className="absolute inset-0 bg-emerald-100/20 blur-2xl rounded-full opacity-0 group-focus-within:opacity-100 transition-opacity duration-1000"></div>
            <input
              autoFocus
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Continue thoughts..."
              className="relative w-full bg-white/90 border border-stone-200 rounded-full pl-5 md:pl-8 pr-14 md:pr-16 py-3 md:py-5 text-stone-800 placeholder-stone-300 focus:outline-none focus:ring-4 focus:ring-emerald-50 focus:border-emerald-200 transition-all shadow-sm text-sm md:text-lg font-light"
              disabled={isSending}
            />
            <button
              type="submit"
              disabled={!inputText.trim() || isSending}
              className={`
                absolute right-2 md:right-3 top-1/2 -translate-y-1/2 w-9 h-9 md:w-12 md:h-12 rounded-full flex items-center justify-center transition-all duration-300 active:scale-90
                ${!inputText.trim() || isSending
                  ? 'text-stone-200 bg-transparent'
                  : 'text-white bg-emerald-700 hover:bg-emerald-800 shadow-md'}
              `}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 md:h-6 md:w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </form>
          <div className="mt-3 md:mt-4 flex justify-center opacity-40">
            <p className="text-[8px] md:text-[9px] text-stone-400 font-bold uppercase tracking-[0.2em] text-center">Exploration with Serenity</p>
          </div>
        </div>
      </div>
    </div>
  );
};
