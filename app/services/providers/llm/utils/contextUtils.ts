import { HistoryEntry } from "@/app/types";
import { estimateTokens, daysBetween } from "./tokenUtils";
import * as constants from "./constants";

export interface ContextEntry {
  entry: HistoryEntry;
  score: number;
  tokens: number;
  relevanceReasons?: string[];
}

// Format entry for context (uses summary for older entries to save tokens)
export function formatEntryForContext(
  entry: HistoryEntry,
  includeReflection: boolean = false,
  relevanceScore?: number,
  relevanceReasons?: string[]
): string {
  const daysAgo = daysBetween(entry.timestamp);
  const dateStr = new Date(entry.timestamp).toLocaleDateString();

  let entryText: string;

  if (daysAgo <= constants.DAYS_RECENT) {
    // Recent entries: use full text
    entryText = entry.text;
  } else if (daysAgo <= constants.DAYS_MEDIUM && entry.summary) {
    // Medium entries: use summary
    entryText = `[Summary] ${entry.summary}`;
  } else if (entry.summary) {
    // Old entries: use summary only
    entryText = `[Summary] ${entry.summary}`;
  } else {
    // Fallback: truncate old entries
    entryText = entry.text.length > 200 ? entry.text.substring(0, 200) + '...' : entry.text;
  }

  // Include topic in context if available
  const topicStr = entry.topic ? ` | Topic: ${entry.topic}` : '';

  // Add relevance label with reasons why this entry is relevant
  let relevanceLabel = '';
  if (relevanceReasons && relevanceReasons.length > 0) {
    const reasonsStr = relevanceReasons.join(', ');
    relevanceLabel = ` [Relevant: ${reasonsStr}]`;
  } else if (relevanceScore !== undefined) {
    relevanceLabel = ` [Relevance: ${(relevanceScore * 100).toFixed(0)}%]`;
  }

  let context = `[${dateStr} | ${entry.mood}${topicStr}${relevanceLabel}] ${entryText}`;

  if (includeReflection && daysAgo <= constants.DAYS_RECENT) {
    // Only include full reflection for recent entries
    context += `\nReflection: ${entry.reflection}`;
  } else if (includeReflection && entry.summary) {
    // For older entries, just mention there was a reflection
    context += `\n[Previous reflection available]`;
  }

  return context;
}

// Lightweight re-ranking: boost recent entries and entries with topic matches
export function reRankEntries(
  scoredEntries: Array<{ entry: HistoryEntry; score: number; relevanceReasons?: string[] }>,
  currentTopic: string | undefined
): Array<{ entry: HistoryEntry; score: number; relevanceReasons?: string[] }> {
  const now = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  return scoredEntries.map(scored => {
    let adjustedScore = scored.score;

    // Recency boost: entries from last 7 days get a small boost
    const entryDate = new Date(scored.entry.timestamp);
    entryDate.setHours(0, 0, 0, 0);
    const daysAgo = Math.ceil((now.getTime() - entryDate.getTime()) / (1000 * 60 * 60 * 24));

    if (daysAgo <= 7) {
      // Boost decreases with age: 7 days = +0.05, 0 days = +0.15
      const recencyBoost = 0.15 - (daysAgo / 7) * 0.10;
      adjustedScore = Math.min(1.0, scored.score + recencyBoost);
    }

    // Topic match boost: if topics match, add small boost
    if (currentTopic && scored.entry.topic) {
      const currentTopicLower = currentTopic.toLowerCase().trim();
      const entryTopicLower = scored.entry.topic.toLowerCase().trim();

      if (currentTopicLower === entryTopicLower) {
        adjustedScore = Math.min(1.0, adjustedScore + 0.1); // Exact topic match
      } else if (currentTopicLower.includes(entryTopicLower) || entryTopicLower.includes(currentTopicLower)) {
        adjustedScore = Math.min(1.0, adjustedScore + 0.05); // Partial topic match
      }
    }

    return {
      entry: scored.entry,
      score: adjustedScore,
      relevanceReasons: scored.relevanceReasons
    };
  });
}
