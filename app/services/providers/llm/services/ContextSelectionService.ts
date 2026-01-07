import { HistoryEntry, Mood } from "@/app/types";
import { EmbeddingService } from "./EmbeddingService";
import { calculateRelevanceScore } from "../utils/embeddingUtils";
import { formatEntryForContext, reRankEntries, ContextEntry } from "../utils/contextUtils";
import { estimateTokens } from "../utils/tokenUtils";
import * as constants from "../utils/constants";
import logger from "@/app/utils/logger";

const log = logger.module('ContextSelectionService');

export class ContextSelectionService {
  constructor(private embeddingService: EmbeddingService) {}

  async selectRelevantContext(
    currentEntry: string,
    currentMood: Mood,
    currentTopic: string | undefined,
    history: HistoryEntry[],
    maxTokens: number,
    includeReflection: boolean = false
  ): Promise<string> {
    if (history.length === 0) {
      return "No previous history available.";
    }

    // STEP 1: Generate single embedding for current entry
    let currentEmbedding: number[] | null = null;
    try {
      currentEmbedding = await this.embeddingService.generateEmbedding(currentEntry);
      log.debug('Generated single embedding for current entry');
    } catch (error) {
      log.warn('Failed to generate embedding for current entry', {}, error as Error);
    }

    // STEP 2: Generate single embeddings for history entries in parallel
    const embeddingPromises = history.map(async (entry) => {
      try {
        return await this.embeddingService.generateEmbedding(entry.text);
      } catch (error) {
        log.warn('Failed to generate embedding for entry', { entryId: entry.id });
        return null;
      }
    });

    const historyEmbeddings = await Promise.all(embeddingPromises);
    const successfulCount = historyEmbeddings.filter(e => e !== null).length;
    log.debug('Generated embeddings for history entries', {
      successful: successfulCount,
      total: history.length
    });

    // STEP 3: Calculate initial relevance scores (single vector + emotion metadata)
    const scoredEntries = history.map((entry, index) => {
      const { score, reasons } = calculateRelevanceScore(
        currentEmbedding,
        historyEmbeddings[index],
        currentMood,
        entry.mood || 'none'
      );
      return {
        entry,
        score,
        relevanceReasons: reasons.length > 0 ? reasons : undefined,
        tokens: 0 // Will calculate after formatting
      };
    });

    // STEP 4: Filter by minimum relevance threshold
    let filteredEntries = scoredEntries.filter(scored => {
      return scored.score >= constants.MIN_RELEVANCE_SCORE;
    });

    if (filteredEntries.length === 0) {
      // If no entries meet threshold, use the highest scoring one
      const highestScoring = scoredEntries.sort((a, b) => b.score - a.score)[0];
      if (highestScoring) {
        filteredEntries.push(highestScoring);
      }
    }

    // STEP 5: Lightweight re-ranking (post-filter)
    // Sort by score, take top K, then re-rank with recency and topic boosts
    filteredEntries.sort((a, b) => b.score - a.score);
    const topKEntries = filteredEntries.slice(0, constants.RE_RANK_TOP_K);
    const reRankedEntries = reRankEntries(topKEntries, currentTopic);

    // Re-sort after re-ranking
    reRankedEntries.sort((a, b) => b.score - a.score);

    // STEP 6: Calculate tokens and select entries within limit
    const entriesWithTokens = reRankedEntries.map(scored => ({
      ...scored,
      tokens: estimateTokens(
        formatEntryForContext(scored.entry, includeReflection, scored.score, scored.relevanceReasons)
      )
    }));

    const selected: ContextEntry[] = [];
    let totalTokens = 0;

    for (const scored of entriesWithTokens) {
      // Check if we have room
      if (totalTokens + scored.tokens > maxTokens) {
        // Try to fit a shorter version (summary only)
        if (scored.entry.summary && !formatEntryForContext(scored.entry, includeReflection).includes('[Summary]')) {
          const summaryText = formatEntryForContext(
            scored.entry,
            false, // Don't include reflection in summary version
            scored.score,
            scored.relevanceReasons
          ).replace(scored.entry.text, `[Summary] ${scored.entry.summary}`);
          const summaryTokens = estimateTokens(summaryText);

          if (totalTokens + summaryTokens <= maxTokens) {
            const summaryVersion: ContextEntry = {
              ...scored,
              tokens: summaryTokens
            };
            selected.push(summaryVersion);
            totalTokens += summaryTokens;
          }
        }
        continue;
      }

      selected.push(scored);
      totalTokens += scored.tokens;
    }

    // Log context selection for debugging
    log.debug('Selected context entries', {
      selected: selected.length,
      total: history.length,
      tokens: totalTokens
    });
    selected.forEach((scored, idx) => {
      const dateStr = new Date(scored.entry.timestamp).toLocaleDateString();
      log.debug(`Context entry ${idx + 1}`, {
        date: dateStr,
        score: `${(scored.score * 100).toFixed(0)}%`,
        reasons: scored.relevanceReasons?.join(', ') || 'none',
        entryId: scored.entry.id
      });
    });

    // Sort selected entries by date (most recent last, to show progression)
    selected.sort((a, b) => {
      const dateA = new Date(a.entry.timestamp).getTime();
      const dateB = new Date(b.entry.timestamp).getTime();
      return dateA - dateB;
    });

    // Format the context with labels
    const contextParts = selected.map(scored =>
      formatEntryForContext(scored.entry, includeReflection, scored.score, scored.relevanceReasons)
    );
    return contextParts.join('\n\n---\n\n');
  }
}
