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
      <div
        style={{
          background: '#F4F1EB',
          borderLeft: '3px solid #B5A47A',
          borderRadius: 4,
          padding: '32px 36px',
        }}
        className={isLoading ? 'animate-pulse' : ''}
      >
        {!isLoading && reflection && reflection.topic && (
          <div style={{ marginBottom: 16 }}>
            <span style={{
              fontSize: 10,
              textTransform: 'uppercase',
              letterSpacing: '0.12em',
              fontFamily: "'Helvetica Neue', sans-serif",
              color: '#B5A47A',
              background: '#EAE4D6',
              borderRadius: 20,
              padding: '3px 10px',
            }}>
              {reflection.topic}
            </span>
          </div>
        )}

        {isLoading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ height: 14, background: '#E0D8CE', borderRadius: 4, width: '75%' }}></div>
            <div style={{ height: 14, background: '#E0D8CE', borderRadius: 4, width: '100%' }}></div>
            <div style={{ height: 14, background: '#E0D8CE', borderRadius: 4, width: '83%' }}></div>
          </div>
        ) : (
          <div style={{
            fontFamily: 'Georgia, serif',
            fontSize: 16,
            lineHeight: 1.85,
            color: '#4A4238',
            fontStyle: 'italic',
          }}>
            <HighlightedText
              content={reflection?.content || ''}
              highlights={reflection?.highlights}
            />
          </div>
        )}
      </div>
    </div>
  );
};
