import { GoogleGenAI } from "@google/genai";
import { getCachedEmbedding, setCachedEmbedding } from "../utils/embeddingUtils";
import * as constants from "../utils/constants";
import logger from "@/utils/logger";

const log = logger.module('EmbeddingService');

export class EmbeddingService {
  constructor(private ai: GoogleGenAI) { }

  // Generate embedding for text using Gemini API
  async generateEmbedding(text: string): Promise<number[]> {
    // Normalize text for cache key
    const cacheKey = text.trim().toLowerCase();

    // Check cache first
    const cached = getCachedEmbedding(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      // Use Gemini embedding model (text-embedding-004)
      // The API uses 'contents' (plural) and returns 'embeddings' (plural)
      const result = await this.ai.models.embedContent({
        model: 'text-embedding-004',
        contents: [{ text: text.trim() }],
      });

      // Extract embedding from result (first embedding from the array)
      const embedding = result.embeddings?.[0]?.values;

      if (!embedding) {
        throw new Error('No embedding returned from API');
      }

      // Cache the embedding
      setCachedEmbedding(cacheKey, embedding);

      return embedding;
    } catch (error) {
      log.error('Error generating embedding', {}, error as Error);
      throw error;
    }
  }
}
