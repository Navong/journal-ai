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

  // Important phrases to highlight (multi-word patterns)
  const phrasePatterns = [
    // Emotion phrases (feeling + emotion)
    'feeling anxious', 'feeling stressed', 'feeling overwhelmed', 'feeling tired',
    'feeling happy', 'feeling calm', 'feeling grateful', 'feeling proud',
    'feeling worried', 'feeling frustrated', 'feeling excited',
    
    // Insight phrases (understanding/realization)
    'starting to realize', 'beginning to understand', 'starting to notice',
    'I realize', 'I understand', 'I notice', 'I recognize',
    'it sounds like', 'it seems like', 'it appears',
    
    // Progress phrases
    'making progress', 'moving forward', 'taking steps',
    'working through', 'working on', 'dealing with',
    
    // Support phrases
    'reaching out', 'asking for help', 'seeking support',
    'taking care', 'being kind', 'showing compassion',
    
    // Challenge phrases
    'struggling with', 'dealing with', 'working through',
    'facing challenges', 'going through',
    
    // Time phrases
    'upcoming deadline', 'project deadline', 'important deadline',
    'next week', 'this week', 'coming up',
    
    // Relationship phrases
    'talking with', 'meeting with', 'spending time with',
    'conversation with', 'discussed with'
  ];

  // Process text to add highlights - BOLD PHRASES (not individual words)
  const processText = (text: string): React.ReactNode[] => {
    const patterns: Array<{ regex: RegExp; className: string; type: string; priority: number }> = [];

    // Simple bold highlight - no colors, no backgrounds
    const highlightClass = 'font-bold';

    // Priority 1: Multi-word phrases (highest priority - matched first)
    phrasePatterns.forEach(phrase => {
      patterns.push({
        regex: new RegExp(`\\b(${escapeRegex(phrase)})\\b`, 'gi'),
        className: highlightClass,
        type: 'phrase',
        priority: 1
      });
    });

    // Priority 2: Entity names (matched after phrases)
    if (entities) {
      // People (might be full names like "Sarah Johnson")
      entities.people.forEach(person => {
        if (person && person.trim()) {
          patterns.push({
            regex: new RegExp(`\\b(${escapeRegex(person)})\\b`, 'gi'),
            className: highlightClass,
            type: 'person',
            priority: 2
          });
        }
      });

      // Places (might be multi-word like "Central Park")
      entities.places.forEach(place => {
        if (place && place.trim()) {
          patterns.push({
            regex: new RegExp(`\\b(${escapeRegex(place)})\\b`, 'gi'),
            className: highlightClass,
            type: 'place',
            priority: 2
          });
        }
      });

      // Events (likely multi-word like "team meeting")
      entities.events.forEach(event => {
        if (event.name && event.name.trim()) {
          patterns.push({
            regex: new RegExp(`\\b(${escapeRegex(event.name)})\\b`, 'gi'),
            className: highlightClass,
            type: 'event',
            priority: 2
          });
        }
      });

      // Organizations
      entities.organizations.forEach(org => {
        if (org && org.trim()) {
          patterns.push({
            regex: new RegExp(`\\b(${escapeRegex(org)})\\b`, 'gi'),
            className: highlightClass,
            type: 'organization',
            priority: 2
          });
        }
      });
    }

    // Apply highlights
    if (patterns.length === 0) {
      return [text];
    }

    // Sort patterns by priority (phrases first, then entities)
    patterns.sort((a, b) => a.priority - b.priority);

    // Find all matches
    const allMatches: Array<{ start: number; end: number; className: string; text: string; priority: number }> = [];

    patterns.forEach(pattern => {
      const regex = new RegExp(pattern.regex);
      let match;
      while ((match = regex.exec(text)) !== null) {
        allMatches.push({
          start: match.index,
          end: match.index + match[0].length,
          className: pattern.className,
          text: match[0],
          priority: pattern.priority
        });
      }
    });

    if (allMatches.length === 0) {
      return [text];
    }

    // Sort by priority first (lower = higher priority), then by length (longer = higher priority), then position
    allMatches.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      const lengthDiff = (b.end - b.start) - (a.end - a.start);
      if (lengthDiff !== 0) return lengthDiff;
      return a.start - b.start;
    });

    // Remove overlapping matches (keep longer/higher priority matches)
    const filteredMatches: typeof allMatches = [];
    allMatches.forEach(match => {
      // Check if this match overlaps with any already-selected match
      const hasOverlap = filteredMatches.some(existing => 
        (match.start >= existing.start && match.start < existing.end) ||
        (match.end > existing.start && match.end <= existing.end) ||
        (match.start <= existing.start && match.end >= existing.end)
      );
      
      if (!hasOverlap) {
        filteredMatches.push(match);
      }
    });

    // Re-sort by position for rendering
    filteredMatches.sort((a, b) => a.start - b.start);

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

      // Add highlighted match (bold only, no mark element)
      result.push(
        <strong
          key={`bold-${idx}`}
          className={match.className}
        >
          {match.text}
        </strong>
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
