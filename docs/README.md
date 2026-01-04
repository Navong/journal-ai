# Serenity Journal Documentation

Welcome to the Serenity Journal documentation. This folder contains all technical documentation organized by topic.

## Audio System

- **[Storage Format](audio/storage-format.md)** - Audio format pipeline and data flow (WAV → base64 → binary streaming)
- **[Streaming Implementation](audio/streaming-implementation.md)** - Progressive audio playback implementation
- **[Cache Optimization](audio/cache-optimization.md)** - Database binary streaming optimization (21s → 1.4s)
- **[Behavior](audio/behavior.md)** - Audio system behavior and patterns

## Performance Optimization

- **[Database Audio Fetch](performance/database-audio-fetch.md)** - Optimizing database audio retrieval (21s → 1.4s)
- **[Audio Compression](performance/audio-compression.md)** - Gzip compression for 77% size reduction (6MB → 1.5MB)
- **[TTS Improvements](performance/tts-improvements.md)** - Text-to-speech API optimizations
- **[Streaming Migration](performance/streaming-migration.md)** - Migration from base64 chunks to progressive streaming

## API Integration

- **[Gemini Live API](api/gemini-live-api.md)** - Google Gemini API integration and usage

## Bug Fixes

- **[Audio Early Stop](bugfixes/audio-early-stop.md)** - Fix for audio stopping prematurely

## Archive

- **[Old Streaming Docs](archive/)** - Superseded implementation documentation (kept for historical reference)
  - `audio-streaming-summary.md` - Original streaming summary
  - `audio-streaming-final-update.md` - Final update before current implementation
  - `audio-streaming-implementation-complete.md` - Original implementation docs

## Project Documentation (Root Level)

The following documentation remains in the project root:

- **`README.md`** - Main project README with setup instructions
- **`CLAUDE.md`** - Claude Code AI assistant instructions and project overview
- **Feature Implementation Docs**:
  - `ENTITY_IMPLEMENTATION.md` - Entity extraction and tracking
  - `HIGHLIGHTING_SYSTEM.md` - Text highlighting system
  - `SECURITY_ENCRYPTION.md` - Security and encryption implementation

## Quick Start

For new developers:
1. Start with the main [README.md](../README.md) for project setup
2. Read [CLAUDE.md](../CLAUDE.md) for project architecture overview
3. Review [Audio Streaming Implementation](audio/streaming-implementation.md) for audio system understanding
4. Check [Performance Optimization](performance/) docs for optimization strategies

## Contributing to Documentation

When adding new documentation:
- Place audio-related docs in `audio/`
- Place performance docs in `performance/`
- Place API integration docs in `api/`
- Place bugfix docs in `bugfixes/`
- Outdated docs go to `archive/`
- Update this index when adding new docs
