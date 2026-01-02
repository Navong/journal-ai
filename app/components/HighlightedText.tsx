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
    // Using ONLY emerald/green tones to match app theme - clean and minimal
    const patterns: Array<{ regex: RegExp; className: string; type: string }> = [];

    // Add entity patterns - ALL use emerald theme for consistency
    if (entities) {
      // People - subtle emerald highlight
      entities.people.forEach(person => {
        patterns.push({
          regex: new RegExp(`\\b(${person})\\b`, 'gi'),
          className: 'font-semibold text-emerald-800 underline decoration-emerald-300 decoration-2 underline-offset-2',
          type: 'person'
        });
      });

      // Places - subtle emerald highlight (slightly lighter)
      entities.places.forEach(place => {
        patterns.push({
          regex: new RegExp(`\\b(${place})\\b`, 'gi'),
          className: 'font-semibold text-emerald-700 underline decoration-emerald-200 decoration-2 underline-offset-2',
          type: 'place'
        });
      });

      // Events - emerald highlight with slightly stronger emphasis
      entities.events.forEach(event => {
        const className = event.deadline
          ? 'font-bold text-emerald-900 underline decoration-emerald-400 decoration-2 underline-offset-2'
          : 'font-semibold text-emerald-800 underline decoration-emerald-300 decoration-2 underline-offset-2';
        patterns.push({
          regex: new RegExp(`\\b(${event.name})\\b`, 'gi'),
          className,
          type: event.deadline ? 'deadline' : 'event'
        });
      });

      // Organizations - emerald highlight
      entities.organizations.forEach(org => {
        patterns.push({
          regex: new RegExp(`\\b(${org})\\b`, 'gi'),
          className: 'font-semibold text-emerald-700 underline decoration-emerald-200 decoration-2 underline-offset-2',
          type: 'organization'
        });
      });
    }

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
