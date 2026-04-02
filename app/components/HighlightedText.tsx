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
 * Highlights phrases via underline only (decoration color varies by category).
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

  // Underline-only emphasis; decoration color hints category (tooltip has full label)
  const getStyleForType = (type: HighlightType): string => {
    const base = 'underline decoration-2 underline-offset-[3px]';
    switch (type) {
      case 'somatic_stressor':
        return `${base} decoration-red-500`;
      case 'identity_win':
        return `${base} decoration-amber-600`;
      case 'main_idea':
        return `${base} decoration-purple-600`;
      default:
        return `${base} decoration-stone-500`;
    }
  };

  // Format type label for tooltip
  const formatTypeLabel = (type: HighlightType): string => {
    switch (type) {
      case 'somatic_stressor': return 'Somatic Stressor';
      case 'identity_win': return 'Identity Win';
      case 'main_idea': return 'Main Idea';
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
