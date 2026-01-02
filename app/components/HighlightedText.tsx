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
 * Uses 3 focused categories for clean visual narrative:
 * 
 * 1. Somatic Stressor - Physical symptoms + external triggers (red underline)
 *    Examples: "jaw is tight", "deadline pressure", "chest feels heavy"
 * 
 * 2. Moment of Agency - Actions taken, voice used, NOT celebratory (gold highlight)
 *    Examples: "set a boundary", "spoke up", "made the decision"
 *    Note: This replaces the old "identity_win" - focus on noticing, not celebrating
 * 
 * 3. Main Idea - Core insight or central observation (purple emphasis)
 *    Examples: "uncertainty is part of growth", "this feeling makes sense"
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

  // Normalize highlight type (handle legacy 'identity_win' → 'moment_of_agency')
  const normalizeType = (type: string): HighlightType => {
    if (type === 'identity_win') return 'moment_of_agency';
    return type as HighlightType;
  };

  // Get style class for each highlight type
  const getStyleForType = (type: HighlightType | 'identity_win'): string => {
    const normalizedType = normalizeType(type);
    switch (normalizedType) {
      case 'somatic_stressor':
        // Physical symptoms + external triggers - soft red glow with underline
        return 'underline decoration-red-400 decoration-2 underline-offset-2 text-red-900 font-medium bg-red-50/50 px-0.5 rounded';
      
      case 'moment_of_agency':
        // Moments of action/voice - gold background (not celebratory, just noticing)
        return 'font-bold bg-amber-50 text-amber-900 px-1 py-0.5 rounded shadow-sm';
      
      case 'main_idea':
        // Core insight/main theme - purple background with subtle emphasis
        return 'font-semibold bg-purple-50 text-purple-900 px-1 py-0.5 rounded border-b-2 border-purple-300';
      
      default:
        return 'font-semibold';
    }
  };

  // Format type label for tooltip
  const formatTypeLabel = (type: HighlightType | 'identity_win'): string => {
    const normalizedType = normalizeType(type);
    switch (normalizedType) {
      case 'somatic_stressor': return 'Stressor';
      case 'moment_of_agency': return 'Agency';
      case 'main_idea': return 'Key Insight';
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
      const normalizedText = highlight.text.trim().toLowerCase();
      const normalizedType = normalizeType(highlight.type);
      highlightMap.set(normalizedText, {
        type: normalizedType,
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
