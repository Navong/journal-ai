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
  // Helper function to escape special regex characters
  const escapeRegex = (str: string): string => {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  };

  // Important words to highlight - all in ONE color (emerald)
  const importantWords = [
    // Strong emotions
    'anxious', 'anxiety', 'worried', 'stress', 'stressed', 'stressful',
    'happy', 'joyful', 'joy', 'excited', 'excitement',
    'sad', 'sadness', 'depressed', 'depression',
    'tired', 'exhausted', 'fatigue', 'drained',
    'calm', 'peaceful', 'serene', 'relaxed',
    'angry', 'frustrated', 'irritated',
    'grateful', 'thankful', 'blessed',
    'proud', 'accomplished', 'confident',
    'overwhelmed', 'burden', 'difficult', 'challenging',
    
    // Important actions/verbs
    'realize', 'realized', 'understand', 'understood',
    'notice', 'noticed', 'recognize', 'recognized',
    'feel', 'feeling', 'felt',
    'struggle', 'struggling', 'struggled',
    'achieve', 'achieved', 'accomplish', 'accomplished',
    
    // Time/urgency
    'deadline', 'urgent', 'important', 'priority',
    'today', 'tomorrow', 'soon', 'now'
  ];

  // Process text to add highlights - ONE COLOR ONLY (emerald)
  const processText = (text: string): React.ReactNode[] => {
    const patterns: Array<{ regex: RegExp; className: string; type: string }> = [];

    // Single highlight style - emerald background with darker text
    const highlightClass = 'bg-emerald-50 text-emerald-900 px-1 py-0.5 rounded font-medium';

    // Add entity patterns if available
    if (entities) {
      // People
      entities.people.forEach(person => {
        if (person && person.trim()) {
          patterns.push({
            regex: new RegExp(`\\b(${escapeRegex(person)})\\b`, 'gi'),
            className: highlightClass,
            type: 'person'
          });
        }
      });

      // Places
      entities.places.forEach(place => {
        if (place && place.trim()) {
          patterns.push({
            regex: new RegExp(`\\b(${escapeRegex(place)})\\b`, 'gi'),
            className: highlightClass,
            type: 'place'
          });
        }
      });

      // Events
      entities.events.forEach(event => {
        if (event.name && event.name.trim()) {
          patterns.push({
            regex: new RegExp(`\\b(${escapeRegex(event.name)})\\b`, 'gi'),
            className: highlightClass,
            type: 'event'
          });
        }
      });

      // Organizations
      entities.organizations.forEach(org => {
        if (org && org.trim()) {
          patterns.push({
            regex: new RegExp(`\\b(${escapeRegex(org)})\\b`, 'gi'),
            className: highlightClass,
            type: 'organization'
          });
        }
      });
    }

    // Add important word patterns
    importantWords.forEach(word => {
      patterns.push({
        regex: new RegExp(`\\b(${word})\\b`, 'gi'),
        className: highlightClass,
        type: 'important'
      });
    });

    // Apply highlights
    if (patterns.length === 0) {
      return [text];
    }

    // Find all matches
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

    if (allMatches.length === 0) {
      return [text];
    }

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
    let lastIndex = 0;

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
