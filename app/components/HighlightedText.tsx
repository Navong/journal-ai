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

  // Log entities for debugging
  React.useEffect(() => {
    if (entities) {
      console.log('[HighlightedText] Entities received:', entities);
    }
  }, [entities]);

  // Process text to add highlights
  const processText = (text: string): React.ReactNode[] => {
    // Build regex patterns for highlighting
    // Using ONLY emerald/green tones to match app theme - clean and minimal
    const patterns: Array<{ regex: RegExp; className: string; type: string }> = [];

    // Add entity patterns - ALL use emerald theme for consistency
    if (entities) {
      console.log('[HighlightedText] Processing entities for highlighting');
      
      // People - subtle emerald highlight
      entities.people.forEach(person => {
        if (person && person.trim()) {
          patterns.push({
            regex: new RegExp(`\\b(${escapeRegex(person)})\\b`, 'gi'),
            className: 'font-semibold text-emerald-800 underline decoration-emerald-300 decoration-2 underline-offset-2',
            type: 'person'
          });
          console.log(`[HighlightedText] Added pattern for person: ${person}`);
        }
      });

      // Places - subtle emerald highlight (slightly lighter)
      entities.places.forEach(place => {
        if (place && place.trim()) {
          patterns.push({
            regex: new RegExp(`\\b(${escapeRegex(place)})\\b`, 'gi'),
            className: 'font-semibold text-emerald-700 underline decoration-emerald-200 decoration-2 underline-offset-2',
            type: 'place'
          });
          console.log(`[HighlightedText] Added pattern for place: ${place}`);
        }
      });

      // Events - emerald highlight with slightly stronger emphasis
      entities.events.forEach(event => {
        if (event.name && event.name.trim()) {
          const className = event.deadline
            ? 'font-bold text-emerald-900 underline decoration-emerald-400 decoration-2 underline-offset-2'
            : 'font-semibold text-emerald-800 underline decoration-emerald-300 decoration-2 underline-offset-2';
          patterns.push({
            regex: new RegExp(`\\b(${escapeRegex(event.name)})\\b`, 'gi'),
            className,
            type: event.deadline ? 'deadline' : 'event'
          });
          console.log(`[HighlightedText] Added pattern for event: ${event.name} (deadline: ${event.deadline})`);
        }
      });

      // Organizations - emerald highlight
      entities.organizations.forEach(org => {
        if (org && org.trim()) {
          patterns.push({
            regex: new RegExp(`\\b(${escapeRegex(org)})\\b`, 'gi'),
            className: 'font-semibold text-emerald-700 underline decoration-emerald-200 decoration-2 underline-offset-2',
            type: 'organization'
          });
          console.log(`[HighlightedText] Added pattern for organization: ${org}`);
        }
      });
      
      console.log(`[HighlightedText] Total patterns created: ${patterns.length}`);
    } else {
      console.log('[HighlightedText] No entities provided - skipping highlighting');
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
        console.log(`[HighlightedText] Found match: "${match[0]}" at position ${match.index}`);
      }
    });

    console.log(`[HighlightedText] Total matches found: ${allMatches.length}`);

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

  // If no entities or no content, just render plain markdown
  if (!entities || !content) {
    console.log('[HighlightedText] No entities or content, rendering plain text');
    return (
      <div className="text-stone-800 text-base leading-[1.8]">
        <ReactMarkdown>{content}</ReactMarkdown>
      </div>
    );
  }

  return (
    <div className="text-stone-800 text-base leading-[1.8]">
      <ReactMarkdown components={renderers}>
        {content}
      </ReactMarkdown>
    </div>
  );
};
