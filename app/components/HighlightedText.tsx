'use client';

import React from 'react';
import ReactMarkdown from 'react-markdown';
import { Highlight, HighlightType } from '../types';

interface HighlightedTextProps {
  content: string;
  highlights?: Highlight[]; // AI-provided highlights
}

/**
 * Highlights phrases in reflection text based on AI-detected categories
 * Uses 4 categories for sophisticated visual narrative:
 * 1. Somatic Markers - Physical sensations (red glow)
 * 2. Identity Anchors - Strengths/achievements (gold/yellow)
 * 3. External Stressors - People/events causing stress (grey/purple)
 * 4. Emotional Shifts - Emotion changes (blue/italic)
 */
export const HighlightedText: React.FC<HighlightedTextProps> = ({ content, highlights }) => {
  // If no highlights provided, render plain text
  if (!highlights || highlights.length === 0) {
    return (
      <div className="text-stone-800 text-base leading-[1.8]">
        <ReactMarkdown>{content}</ReactMarkdown>
      </div>
    );
  }

  // Get style class for each highlight type
  const getStyleForType = (type: HighlightType): string => {
    switch (type) {
      case 'somatic_marker':
        // Physical sensations - subtle red underline
        return 'underline decoration-red-400 decoration-2 underline-offset-2 font-semibold text-stone-900';
      
      case 'identity_anchor':
        // Strengths/achievements - bold with subtle gold background
        return 'font-bold bg-amber-50 text-amber-900 px-1 py-0.5 rounded';
      
      case 'external_stressor':
        // External stressors - subtle purple/grey box
        return 'bg-stone-100 text-stone-800 px-1 py-0.5 rounded border border-stone-200 font-medium';
      
      case 'emotional_shift':
        // Emotional shifts - italic with subtle blue tint
        return 'italic text-blue-900 font-medium';
      
      default:
        return 'font-semibold';
    }
  };

  // Helper to escape special regex characters
  const escapeRegex = (str: string): string => {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  };

  // Build list of all matches in the text
  const allMatches: Array<{ 
    start: number; 
    end: number; 
    text: string; 
    className: string; 
    type: HighlightType 
  }> = [];

  highlights.forEach(highlight => {
    if (!highlight.text || !highlight.text.trim()) return;

    // Find all occurrences of this phrase in the content
    const regex = new RegExp(`\\b(${escapeRegex(highlight.text.trim())})\\b`, 'gi');
    let match;
    
    while ((match = regex.exec(content)) !== null) {
      allMatches.push({
        start: match.index,
        end: match.index + match[0].length,
        text: match[0],
        className: getStyleForType(highlight.type),
        type: highlight.type
      });
    }
  });

  // If no matches found, render plain text
  if (allMatches.length === 0) {
    return (
      <div className="text-stone-800 text-base leading-[1.8]">
        <ReactMarkdown>{content}</ReactMarkdown>
      </div>
    );
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

  // Build highlighted text
  const buildHighlightedText = (): React.ReactNode[] => {
    const result: React.ReactNode[] = [];
    let lastIndex = 0;

    filteredMatches.forEach((match, idx) => {
      // Add text before match
      if (match.start > lastIndex) {
        result.push(
          <span key={`text-${idx}`}>
            {content.substring(lastIndex, match.start)}
          </span>
        );
      }

      // Add highlighted phrase
      result.push(
        <span
          key={`highlight-${idx}`}
          className={match.className}
          title={formatTypeLabel(match.type)}
        >
          {match.text}
        </span>
      );

      lastIndex = match.end;
    });

    // Add remaining text
    if (lastIndex < content.length) {
      result.push(
        <span key="text-final">
          {content.substring(lastIndex)}
        </span>
      );
    }

    return result;
  };

  // Format type label for tooltip
  const formatTypeLabel = (type: HighlightType): string => {
    switch (type) {
      case 'somatic_marker': return 'Physical sensation';
      case 'identity_anchor': return 'Personal strength';
      case 'external_stressor': return 'External stressor';
      case 'emotional_shift': return 'Emotional shift';
      default: return 'Highlighted';
    }
  };

  return (
    <div className="text-stone-800 text-base leading-[1.8]">
      {buildHighlightedText()}
    </div>
  );
};
