# System Patterns: Serenity Journal

## Core Architecture

### AI Provider Abstraction (NEW)
- **Pattern**: Provider Interface + Factory
- **Interface**: `LLMProvider` defines standard methods for mood detection, topic identification, and reflection generation (streaming and non-streaming).
- **Factory**: `getLLMProvider(type)` returns the singleton instance of the requested provider.
- **Benefits**:
  - Eliminates direct dependencies on specific AI SDKs in the core service layer.
  - Enables hot-switching between models (e.g., Gemini 1.5 Pro to Grok 4.1 Fast).
  - Standardizes error handling and usage tracking across different APIs.

### Service Layer Organization
- **Pattern**: Domain-driven services under `app/lib/core/` and `app/lib/llm/`.
- **Core Service**: `JournalAIService` orchestrates the journaling logic, delegating specific AI tasks to the active `LLMProvider`.
- **LLM Services**: Specialized implementations (`GeminiLLMProvider`, `GrokLLMProvider`) handle API-specific logic.

## AI Implementation Patterns

### Context Selection Algorithm
- **Mechanism**: Hybrid semantic and metadata-based relevance scoring.
- **Steps**:
  1. Generate embeddings for current and historical entries.
  2. Calculate cosine similarity.
  3. Apply mood correlation weights (boost entries with similar emotional tones).
  4. Apply time-decay penalty (favour recent entries for continuity).
  5. Select Top-K entries within token budget for the final prompt.

### JSON-Mode Streaming
- **Pattern**: Structured output parsing with a Compassionate Companion persona.
- **Implementation**: Providers are instructed to return valid JSON.
- **Streaming**: For real-time feel, the core service extracts the `reflection` field from the structured AI response and feeds it to the UI chunk-by-chunk.

## Data Persistence & Safety

### Multi-Region Database
- **Provider**: Supabase (PostgreSQL).
- **Strategy**: Dual connection strings for optimized serverless performance (Connection Pooling) and stable schema migrations (Direct Connection).

### User Isolation Logic
- **Mechanism**: Every query is scoped by `userId`.
- **In-Memory Safety**: Singleton service instances maintain state per-session without cross-user data leakage.

## Performance Optimization

### 3-Layer Context Caching
1. **LRU Embedding Cache**: Prevents re-calculating expensive vectors for unchanged entry text.
2. **System Token Cache**: Leverages provider-specific caching (e.g., Google Gemini Context Caching) for repeated system instructions and common context.
3. **Analytics Cache**: Tracks token usage locally before flushing to persistent storage.

---

*Architectural patterns focus on interchangeability of AI providers and high-performance context retrieval while maintaining strict user data isolation.*
journal_entries {
