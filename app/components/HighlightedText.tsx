'use client';

import React from 'react';
import ReactMarkdown from 'react-markdown';
import { Highlight, HighlightType } from '../types';
import { Components } from 'react-markdown';

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
 * 
 * Also processes markdown syntax (bold, italic, etc.)
 */
export const HighlightedText: React.FC<HighlightedTextProps> = ({ content, highlights }) => {
  // If no highlights provided, render with markdown only
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

  // Helper to escape special regex characters
  const escapeRegex = (str: string): string => {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  };

  // Build a map of text -> highlight for quick lookup
  const highlightMap = new Map<string, { type: HighlightType; className: string }>();
  highlights.forEach(highlight => {
    if (highlight.text && highlight.text.trim()) {
      const normalized = highlight.text.trim().toLowerCase();
      highlightMap.set(normalized, {
        type: highlight.type,
        className: getStyleForType(highlight.type)
      });
    }
  });

  // Custom text renderer that applies highlights
  const applyHighlights = (text: string): React.ReactNode => {
    if (!text || highlightMap.size === 0) return text;

    // Build regex pattern for all highlight phrases
    const patterns = Array.from(highlightMap.keys()).map(escapeRegex);
    if (patterns.length === 0) return text;
    
    const regex = new RegExp(`\\b(${patterns.join('|')})\\b`, 'gi');
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match;
    let matchIndex = 0;

    while ((match = regex.exec(text)) !== null) {
      // Add text before match
      if (match.index > lastIndex) {
        parts.push(text.substring(lastIndex, match.index));
      }

      // Add highlighted phrase
      const matchedText = match[0];
      const normalized = matchedText.toLowerCase();
      const highlightData = highlightMap.get(normalized);

      if (highlightData) {
        parts.push(
          <span
            key={`highlight-${matchIndex++}`}
            className={highlightData.className}
            title={formatTypeLabel(highlightData.type)}
          >
            {matchedText}
          </span>
        );
      } else {
        parts.push(matchedText);
      }

      lastIndex = match.index + matchedText.length;
    }

    // Add remaining text
    if (lastIndex < text.length) {
      parts.push(text.substring(lastIndex));
    }

    return parts.length > 0 ? <>{parts}</> : text;
  };

  // Recursively process all children to apply highlights to text nodes
  const processNode = (node: React.ReactNode): React.ReactNode => {
    if (typeof node === 'string') {
      return applyHighlights(node);
    }
    
    if (React.isValidElement(node) && node.props) {
      const props = node.props as any;
      const children = props.children;
      if (children) {
        const processedChildren = React.Children.map(children, child => processNode(child));
        return React.cloneElement(node, { ...props, children: processedChildren });
      }
    }
    
    return node;
  };

  // Custom components for ReactMarkdown that apply highlights
  const components: Components = {
    p: ({ children }) => <p>{processNode(children)}</p>,
    strong: ({ children }) => <strong>{processNode(children)}</strong>,
    em: ({ children }) => <em>{processNode(children)}</em>,
  };

  return (
    <div className="text-stone-800 text-base leading-[1.8]">
      <ReactMarkdown components={components}>{content}</ReactMarkdown>
    </div>
  );
};
