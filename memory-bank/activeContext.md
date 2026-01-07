# Active Context: Serenity Journal

## Current Focus Areas

### Multi-LLM Provider Integration
- **Status**: Completed core integration for Gemini and Grok
- **Goal**: Enable provider switching and comparison for optimized reflections
- **Impact**: Provides flexibility and redundancy in AI selection
- **Priority**: High (Enhanced flexibility)

### Reasoning Token Tracking
- **Recent Work**: Implemented `reasoningTokens` tracking in `TokenUsage` metadata
- **Current Challenge**: Capturing model-specific usage data across different provider SDKs
- **Status**: Successfully integrated reasoning token extraction for Grok via OpenRouter SDK

### Memory Bank Maintenance
- **Status**: Updating project state after major refactoring
- **Goal**: Maintain accurate documentation for session continuity

## Current Design Decisions

### Provider Pattern
- **Decision**: Implemented `LLMProvider` interface and `getLLMProvider` factory
- **Rationale**: Decouples business logic from specific AI provider implementation details
- **Benefit**: Easy addition of new LLMs (e.g., GPT-4, Claude) without changing core service logic

### OpenRouter SDK Adoption
- **Decision**: Switched from manual fetch calls to official `@openrouter/sdk` for Grok
- **Rationale**: Better type safety, built-in streaming support, and simplified message handling
- **Tracking**: Using `x-ai/grok-4.1-fast` model

### Public Environment Variables for Testing
- **Decision**: Support `NEXT_PUBLIC_OPENROUTER_API_KEY` alongside `OPENROUTER_API_KEY`
- **Rationale**: Allows browser-based testing on pages like `/test-stream` while maintaining secure server-side primary keys for production

## Recent Changes & Patterns

### Multi-Model Support
- **Change**: Added `GrokLLMProvider` and refactored `JournalAIService` to use a dynamic provider
- **Pattern**: Factory pattern for instantiating selected LLM based on global state or user preference

### Token Metadata Expansion
- **Change**: Updated global `TokenUsage` interface to include optional `reasoningTokens`
- **Utility**: Provides transparency into model "thinking" costs and capabilities

### Text Highlighting Quality Analysis
- **Finding**: Text highlighting quality identified as the real issue with Gemini 2.5 Flash-Lite, not emotional analysis
- **Issue**: Sophisticated highlighting system requires precise understanding of 3 categories (main_idea, somatic_stressor, identity_win) and exact phrase extraction from AI-generated reflection text
- **Impact**: Poor highlights reduce visual narrative quality and user experience
- **Proposed Solutions**:
  - Enhanced highlighting prompts with concrete examples and validation rules
  - Two-phase process: separate reflection generation from highlighting
  - Rule-based fallback highlighting using keyword patterns
  - Quality validation and filtering of AI-generated highlights
  - User feedback integration for highlight adjustment

## Current Working Files

### Active Development Files
- `app/lib/llm/providers/grok.ts` - Refactored OpenRouter SDK implementation
- `app/lib/llm/index.ts` - Provider factory and availability checks
- `app/lib/core/journal.ts` - Core service delegating to selected provider
- `app/test-stream/page.tsx` - Real-time streaming and provider selection test interface

### Recently Modified Files
- `app/types.ts` - Expanded `TokenUsage` interface
- `projects/journal-ai/package.json` - Added `@openrouter/sdk`

## Immediate Next Steps

### Feature Refinement
- [ ] Implement true JSON streaming parser for better real-time UI updates (currently simulated)
- [ ] Add provider selector to main Settings UI
- [ ] Benchmark response quality comparisons between Gemini and Grok

### Technical Optimization
- [ ] Consolidate entity extraction logic into a shared service across providers
- [ ] Implement persistent preference storage for the selected LLM provider

## Active Constraints

### Client-Side API Key Security
- **Risk**: Using `NEXT_PUBLIC_` keys exposes them to any user accessing the test page
- **Mitigation**: Recommend using server-only keys for production and restricted keys for development testing
- [ ] Implement comprehensive error boundaries
