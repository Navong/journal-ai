import { Mood } from "@/types";

// Embedding cache for performance (in-memory cache of embeddings)
const embeddingCache = new Map<string, number[]>();

// Calculate cosine similarity between two embedding vectors
export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) {
    throw new Error('Embedding vectors must have the same length');
  }

  // Dot product
  let dotProduct = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
  }

  // Calculate norms
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);

  // Cosine similarity (0-1, where 1 = identical meaning)
  if (normA === 0 || normB === 0) {
    return 0;
  }
  return dotProduct / (normA * normB);
}

// Calculate mood similarity score using emotion metadata
export function calculateMoodSimilarity(currentMood: Mood, entryMood: Mood): number {
  // Exact match
  if (currentMood === entryMood) return 1.0;

  // Mood similarity groups (emotionally related moods)
  const moodGroups: Record<Mood, Mood[]> = {
    'calm': ['reflective', 'none'],
    'joyful': ['reflective'],
    'anxious': ['tired', 'heavy'],
    'tired': ['anxious', 'heavy', 'none'],
    'reflective': ['calm', 'joyful', 'none'],
    'heavy': ['anxious', 'tired'],
    'none': ['calm', 'reflective', 'tired']
  };

  // Check if moods are in the same emotional group
  const currentGroup = moodGroups[currentMood] || [];
  if (currentGroup.includes(entryMood)) {
    return 0.6; // Related mood
  }

  // Opposite moods (less relevant)
  const oppositePairs: [Mood, Mood][] = [
    ['joyful', 'heavy'],
    ['joyful', 'anxious'],
    ['calm', 'anxious'],
    ['calm', 'heavy']
  ];

  for (const [mood1, mood2] of oppositePairs) {
    if ((currentMood === mood1 && entryMood === mood2) ||
      (currentMood === mood2 && entryMood === mood1)) {
      return 0.2; // Opposite mood
    }
  }

  // Neutral similarity
  return 0.4;
}

// Calculate relevance score using single vector + emotion metadata
export function calculateRelevanceScore(
  currentEmbedding: number[] | null,
  entryEmbedding: number[] | null,
  currentMood: Mood,
  entryMood: Mood
): { score: number; reasons: string[] } {
  // Semantic similarity from single vector
  let semanticScore = 0.5; // Default neutral score
  if (currentEmbedding && entryEmbedding) {
    try {
      semanticScore = cosineSimilarity(currentEmbedding, entryEmbedding);
    } catch (error) {
      console.warn('Error calculating semantic similarity', error);
    }
  }

  // Mood similarity from emotion metadata
  const moodScore = calculateMoodSimilarity(currentMood, entryMood);

  // Weighted combination: semantic (75%) + mood (25%)
  const finalScore = (
    semanticScore * 0.75 +
    moodScore * 0.25
  );

  // Build reasons array
  const reasons: string[] = [];

  if (semanticScore >= 0.7) {
    reasons.push('very similar content');
  } else if (semanticScore >= 0.5) {
    reasons.push('similar content');
  } else if (semanticScore >= 0.3) {
    reasons.push('somewhat similar content');
  }

  if (moodScore >= 0.8) {
    reasons.push('same mood');
  } else if (moodScore >= 0.6) {
    reasons.push('related mood');
  }

  if (reasons.length === 0 && finalScore >= 0.4) {
    reasons.push('semantically relevant');
  }

  return { score: finalScore, reasons };
}

// Get embedding from cache or return null if not found
export function getCachedEmbedding(cacheKey: string): number[] | null {
  return embeddingCache.get(cacheKey) || null;
}

// Set embedding in cache with size management
export function setCachedEmbedding(cacheKey: string, embedding: number[]): void {
  embeddingCache.set(cacheKey, embedding);

  // Limit cache size to prevent memory issues (keep last 100 embeddings)
  if (embeddingCache.size > 100) {
    const firstKey = embeddingCache.keys().next().value;
    if (firstKey) {
      embeddingCache.delete(firstKey);
    }
  }
}
