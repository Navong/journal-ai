'use client';

import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { ChatMessage } from '../types';

interface ChatInterfaceProps {
  messages: ChatMessage[];
  onSendMessage: (text: string) => void;
  isSending: boolean;
  onClose: () => void;
  contextRevalidated?: boolean;
}

export const ChatInterface: React.FC<ChatInterfaceProps> = ({
  messages,
  onSendMessage,
  isSending,
  onClose,
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
        className="absolute inset-0 cursor-pointer"
        style={{ background: 'rgba(44,40,37,0.35)', backdropFilter: 'blur(4px)' }}
        onClick={onClose}
      />

      {/* Modal Container */}
      <div
        ref={containerRef}
        className="relative w-full flex flex-col overflow-hidden animate-in slide-in-from-bottom-10 duration-500"
        style={{
          background: '#FDFCF8',
          maxWidth: 680,
          height: '70vh',
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
          boxShadow: '0 -8px 40px rgba(44,40,37,0.12)',
        }}
      >
        <style>{`@media (min-width: 640px) { .chat-modal { height: 85vh !important; } }`}</style>

        {/* Header */}
        <div
          className="flex items-center justify-between sticky top-0 z-10"
          style={{ padding: '20px 28px', borderBottom: '1px solid #E8E4DD' }}
        >
          <div>
            <h3 style={{
              fontSize: 13,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              fontFamily: "'Helvetica Neue', sans-serif",
              color: '#A89E92',
              margin: 0,
              fontWeight: 400,
            }}>Conversation</h3>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
              <p style={{
                fontSize: 11,
                color: '#C4BAB0',
                margin: 0,
                fontFamily: "'Helvetica Neue', sans-serif",
              }}>Refining your thoughts</p>
              {contextRevalidated && (
                <span style={{
                  fontSize: 9,
                  color: '#A89E92',
                  background: '#F4F1EB',
                  padding: '1px 6px',
                  borderRadius: 10,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  fontFamily: "'Helvetica Neue', sans-serif",
                  border: '1px solid #E0D8CE',
                }}>
                  Context Updated
                </span>
              )}
            </div>
          </div>

          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: 20,
              color: '#A89E92',
              padding: '4px 8px',
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        {/* Messages Area */}
        <div
          className="flex-grow overflow-y-auto scrollbar-hide"
          style={{ padding: '24px 28px', display: 'flex', flexDirection: 'column', gap: 20 }}
        >
          {messages.length === 0 && (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
              <p style={{
                fontFamily: 'Georgia, serif',
                fontStyle: 'italic',
                color: '#C4BAB0',
                fontSize: 15,
                lineHeight: 1.7,
              }}>
                "Every conversation is a bridge to clarity."<br />
                <span style={{
                  fontSize: 10,
                  fontFamily: "'Helvetica Neue', sans-serif",
                  fontStyle: 'normal',
                  textTransform: 'uppercase',
                  letterSpacing: '0.1em',
                  display: 'inline-block',
                  marginTop: 12,
                  color: '#C4BAB0',
                  opacity: 0.8,
                }}>Ask anything about your thoughts.</span>
              </p>
            </div>
          )}

          {messages.map((msg, i) => {
            const isModel = msg.role === 'model';

            return (
              <div
                key={i}
                className="animate-in fade-in duration-500"
                style={{ display: 'flex', flexDirection: 'column', alignItems: isModel ? 'flex-start' : 'flex-end' }}
              >
                <div
                  style={{
                    maxWidth: '80%',
                    padding: '12px 16px',
                    ...(isModel ? {
                      background: '#F4F1EB',
                      color: '#4A4238',
                      fontStyle: 'italic',
                      borderRadius: '16px 16px 16px 4px',
                      fontFamily: 'Georgia, serif',
                      fontSize: 14,
                      lineHeight: 1.7,
                    } : {
                      background: '#3A3530',
                      color: '#FDFCF8',
                      borderRadius: '16px 16px 4px 16px',
                      fontFamily: "'Helvetica Neue', sans-serif",
                      fontSize: 14,
                      lineHeight: 1.6,
                    }),
                  }}
                >
                  {isModel ? (
                    <div className="prose prose-stone prose-sm leading-relaxed">
                      <ReactMarkdown>{msg.text}</ReactMarkdown>
                    </div>
                  ) : (
                    <div className="whitespace-pre-wrap">{msg.text}</div>
                  )}
                </div>
              </div>
            );
          })}

          {isSending && (
            <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
              <div style={{
                background: '#F4F1EB',
                padding: '12px 16px',
                borderRadius: '16px 16px 16px 4px',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
              }}>
                <div style={{ display: 'flex', gap: 4 }}>
                  <span className="animate-bounce" style={{ width: 6, height: 6, background: '#B5A47A', borderRadius: '50%', display: 'inline-block' }}></span>
                  <span className="animate-bounce" style={{ width: 6, height: 6, background: '#B5A47A', borderRadius: '50%', display: 'inline-block', animationDelay: '0.2s' }}></span>
                  <span className="animate-bounce" style={{ width: 6, height: 6, background: '#B5A47A', borderRadius: '50%', display: 'inline-block', animationDelay: '0.4s' }}></span>
                </div>
                <span style={{
                  fontSize: 10,
                  color: '#A89E92',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  fontFamily: "'Helvetica Neue', sans-serif",
                }}>Serenity is reflecting...</span>
              </div>
            </div>
          )}
          <div ref={scrollRef} style={{ height: 8 }} />
        </div>

        {/* Input Area */}
        <div style={{ padding: '16px 20px', borderTop: '1px solid #E8E4DD' }}>
          <form onSubmit={handleSubmit} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              autoFocus
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Continue thoughts..."
              style={{
                flex: 1,
                background: '#F4F1EB',
                borderRadius: 20,
                padding: '10px 18px',
                border: 'none',
                outline: 'none',
                fontFamily: 'Georgia, serif',
                fontSize: 14,
                color: '#3A3530',
              }}
              disabled={isSending}
            />
            <button
              type="submit"
              disabled={!inputText.trim() || isSending}
              style={{
                width: 36,
                height: 36,
                borderRadius: '50%',
                background: !inputText.trim() || isSending ? '#E0D8CE' : '#3A3530',
                border: 'none',
                cursor: !inputText.trim() || isSending ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                transition: 'background 0.2s',
              }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="#FDFCF8" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
