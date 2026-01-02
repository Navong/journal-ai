'use client';

import React from 'react';
import ReactMarkdown from 'react-markdown';
import { ExtractedEntities } from '../types';

interface HighlightedTextProps {
  content: string;
  entities?: ExtractedEntities;
}

/**
 * Highlights important words and phrases in reflection text
 * - People names: Blue highlight
 * - Places: Green highlight  
 * - Events/Deadlines: Purple/Red highlight
 * - Emotions: Amber highlight
 * - Important phrases: Subtle emphasis
 */
export const HighlightedText: React.FC<HighlightedTextProps> = ({ content, entities }) => {
  // Emotion keywords to highlight
  const emotionWords = [
    'anxious', 'anxiety', 'worried', 'stress', 'stressed', 'stressful',
    'happy', 'joyful', 'joy', 'excited', 'excitement',
    'sad', 'sadness', 'down', 'depressed', 'heavy',
    'tired', 'exhausted', 'fatigue', 'drained',
    'calm', 'peaceful', 'serene', 'relaxed',
    'angry', 'frustrated', 'irritated', 'annoyed',
    'grateful', 'thankful', 'blessed', 'appreciate',
    'confident', 'proud', 'accomplished',
    'overwhelmed', 'burden', 'difficult', 'challenging'
  ];

  // Deadline/urgency keywords
  const urgencyWords = [
    'deadline', 'urgent', 'due', 'soon', 'tomorrow', 'today',
    'pressure', 'rushing', 'hurry', 'quickly', 'asap'
  ];

  // Process text to add highlights
  const processText = (text: string): React.ReactNode[] => {
    // Build regex patterns for highlighting
    const patterns: Array<{ regex: RegExp; className: string; type: string }> = [];

    // Add entity patterns
    if (entities) {
      // People - blue highlight
      entities.people.forEach(person => {
        patterns.push({
          regex: new RegExp(`\\b(${person})\\b`, 'gi'),
          className: 'bg-blue-50 text-blue-900 px-1 rounded font-semibold border-b-2 border-blue-200',
          type: 'person'
        });
      });

      // Places - green highlight
      entities.places.forEach(place => {
        patterns.push({
          regex: new RegExp(`\\b(${place})\\b`, 'gi'),
          className: 'bg-green-50 text-green-900 px-1 rounded font-semibold border-b-2 border-green-200',
          type: 'place'
        });
      });

      // Events - purple/red highlight
      entities.events.forEach(event => {
        const className = event.deadline
          ? 'bg-red-50 text-red-900 px-1 rounded font-bold border-b-2 border-red-300'
          : 'bg-purple-50 text-purple-900 px-1 rounded font-semibold border-b-2 border-purple-200';
        patterns.push({
          regex: new RegExp(`\\b(${event.name})\\b`, 'gi'),
          className,
          type: event.deadline ? 'deadline' : 'event'
        });
      });

      // Organizations - amber highlight
      entities.organizations.forEach(org => {
        patterns.push({
          regex: new RegExp(`\\b(${org})\\b`, 'gi'),
          className: 'bg-amber-50 text-amber-900 px-1 rounded font-semibold border-b-2 border-amber-200',
          type: 'organization'
        });
      });
    }

    // Emotion words - soft amber highlight
    emotionWords.forEach(word => {
      patterns.push({
        regex: new RegExp(`\\b(${word}(?:ed|ing|s)?)\\b`, 'gi'),
        className: 'bg-amber-50/50 text-amber-900 px-0.5 rounded font-medium',
        type: 'emotion'
      });
    });

    // Urgency words - soft red highlight
    urgencyWords.forEach(word => {
      patterns.push({
        regex: new RegExp(`\\b(${word}(?:s)?)\\b`, 'gi'),
        className: 'bg-red-50/50 text-red-800 px-0.5 rounded font-medium',
        type: 'urgency'
      });
    });

    // Apply highlights
    let processedText = text;
    const replacements: Array<{ text: string; className: string; index: number }> = [];

    patterns.forEach(pattern => {
      let match;
      while ((match = pattern.regex.exec(text)) !== null) {
        replacements.push({
          text: match[1],
          className: pattern.className,
          index: match.index
        });
      }
    });

    // Sort by index (reverse order for replacement)
    replacements.sort((a, b) => b.index - a.index);

    // Apply replacements (using unique markers)
    const markedText = text;
    const segments: Array<{ text: string; highlighted?: boolean; className?: string }> = [];
    
    if (replacements.length === 0) {
      return [text];
    }

    // Simple approach: split by patterns and wrap matches
    let lastIndex = 0;
    const allMatches: Array<{ start: number; end: number; className: string; text: string }> = [];

    patterns.forEach(pattern => {
      const regex = new RegExp(pattern.regex);
      let match;
      while ((match = regex.exec(text)) !== null) {
        allMatches.push({
          start: match.index,
          end: match.index + match[0].length,
          className: pattern.className,
          text: match[0]
        });
      }
    });

    // Sort by start position
    allMatches.sort((a, b) => a.start - b.start);

    // Remove overlapping matches (keep first occurrence)
    const filteredMatches: typeof allMatches = [];
    let lastEnd = -1;
    allMatches.forEach(match => {
      if (match.start >= lastEnd) {
        filteredMatches.push(match);
        lastEnd = match.end;
      }
    });

    // Build result
    const result: React.ReactNode[] = [];
    lastIndex = 0;

    filteredMatches.forEach((match, idx) => {
      // Add text before match
      if (match.start > lastIndex) {
        result.push(
          <span key={`text-${idx}`}>
            {text.substring(lastIndex, match.start)}
          </span>
        );
      }

      // Add highlighted match
      result.push(
        <mark
          key={`mark-${idx}`}
          className={`${match.className} transition-all`}
        >
          {match.text}
        </mark>
      );

      lastIndex = match.end;
    });

    // Add remaining text
    if (lastIndex < text.length) {
      result.push(
        <span key="text-final">
          {text.substring(lastIndex)}
        </span>
      );
    }

    return result;
  };

  // Custom renderer for ReactMarkdown
  const renderers = {
    p: ({ children, ...props }: any) => {
      // Process text nodes for highlighting
      const processNode = (node: any): any => {
        if (typeof node === 'string') {
          return processText(node);
        }
        if (React.isValidElement(node)) {
          return node;
        }
        return node;
      };

      const processedChildren = React.Children.map(children, processNode);

      return (
        <p {...props} className="mb-4 last:mb-0 leading-relaxed">
          {processedChildren}
        </p>
      );
    },
    strong: ({ children, ...props }: any) => (
      <strong {...props} className="font-bold text-stone-900">
        {children}
      </strong>
    ),
    em: ({ children, ...props }: any) => (
      <em {...props} className="italic text-stone-700">
        {children}
      </em>
    ),
  };

  return (
    <div className="text-stone-800 text-base leading-[1.8]">
      <ReactMarkdown components={renderers}>
        {content}
      </ReactMarkdown>
    </div>
  );
};
