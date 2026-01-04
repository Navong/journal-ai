# Audio Streaming Implementation in Serenity Journal

## Overview

The Serenity Journal application implements a sophisticated audio streaming system that allows users to convert AI-generated reflections into speech using Cartesia AI's TTS (Text-to-Speech) service. The system features progressive audio playback, caching, and cross-device synchronization.

## Key Components

### 1. API Route: `/api/tts/route.ts`
- **Purpose**: Handles TTS generation requests using Cartesia AI
- **Format**: Outputs WAV/PCM format (44.1kHz, 32-bit float) for progressive decoding
- **Streaming**: Implements binary streaming using ReadableStream API
- **Rate Limiting**: Implements per-user rate limiting (30 requests per minute)
- **Error Handling**: Comprehensive error handling for quota, rate limits, and network issues

### 2. Frontend Service: `geminiService.ts`
- **Purpose**: Manages TTS generation requests from the UI
- **Chunking**: Splits long texts into smaller chunks for better performance
- **Progressive Playback**: Implements callback system for partial audio playback
- **Caching**: Integrates with IndexedDB cache for performance
- **Deduplication**: Prevents duplicate requests for the same text

### 3. Audio Cache: `audioCache.ts`
- **Storage**: Uses IndexedDB for persistent audio caching
- **Format**: Stores audio as base64-encoded strings
- **Keying**: Uses text hash for cache key generation
- **Cleanup**: Automatic cleanup of old entries (30 days) and size limits (50MB)

### 4. Audio Synchronization: `audioSync.ts`
- **Purpose**: Background sync of audio from IndexedDB to Supabase database
- **Frequency**: Runs every 5 minutes
- **Matching**: Matches audio by reflection text hash
- **Progress Tracking**: Provides progress updates during sync

## Audio Streaming Architecture

### Backend (API Route)
```
Client Request → Cartesia TTS API → Binary Stream → ReadableStream → Client Response
```

The API route uses Cartesia's streaming capabilities to return audio data as it's generated, rather than waiting for the complete file. This enables progressive playback.

### Frontend (Progressive Playback)
```
API Stream → Buffer Chunks → Decode Partial Audio → Play → Wait → Play Complete Audio
```

The frontend implements progressive playback by buffering enough audio data (1.5MB) to start playback while the rest of the file continues to download.

### Caching Layer
```
Text → Hash → IndexedDB → Audio (instant) 
  ↓ miss
Supabase → Audio (fast) → Cache Locally
  ↓ miss
Cartesia API → Audio (slow) → Cache Locally + Supabase
```

The system implements a layered caching approach with multiple levels of persistence.

## Technical Details

### Audio Format Selection
- **WAV/PCM**: Chosen over MP3 for progressive decoding capabilities
- **Sample Rate**: 44.1kHz (CD quality) for high fidelity
- **Encoding**: PCM float32 little-endian for compatibility
- **Trade-off**: 10x larger files for 2-3x faster playback start

### Progressive Playback Implementation
- **Buffer Size**: 1.5MB (provides ~8-9 seconds of audio)
- **Playback Strategy**: Play partial audio while continuing to download
- **Continuation**: Wait for partial to end, then continue from where it left off
- **Gap Minimization**: Designed to minimize gaps between partial and complete playback

### Rate Limiting
- **Per-User**: 30 requests per minute per user
- **Implementation**: In-memory rate limiter (Redis in production)
- **Response**: 429 status with Retry-After header
- **Exponential Backoff**: For retry attempts

## Performance Improvements

### Before Implementation
- **Playback Start Time**: 5-6 seconds for MP3 format
- **User Experience**: Users had to wait for complete download
- **Format Limitation**: MP3 requires complete file for playback

### After Implementation
- **Playback Start Time**: 2-3 seconds with WAV progressive streaming
- **User Experience**: Immediate playback after buffering
- **Format Advantage**: WAV allows partial decoding and playback

## Known Issues and Limitations

### 1. Missing Function Reference
- **Issue**: `optimizeAudio` function is referenced in `JournalApp.tsx` but not defined
- **Location**: Line 1873 in `app/components/JournalApp.tsx`
- **Impact**: Potential runtime error when audio optimization is attempted
- **Status**: This appears to be a bug in the implementation

### 2. Gap in Long Audio
- **Issue**: For audio longer than ~20 seconds, there may be a gap between partial and continuation
- **Cause**: Partial plays for a duration while stream takes longer to complete
- **Mitigation**: Buffer size can be adjusted based on expected audio length

### 3. File Size Impact
- **Issue**: WAV files are 10x larger than MP3 equivalents
- **Impact**: Higher bandwidth usage and storage requirements
- **Trade-off**: Better user experience vs. resource usage

## Cross-Device Synchronization

The system implements cross-device audio synchronization through:
1. **Database Storage**: Audio stored in Supabase database
2. **Background Sync**: Automatic sync every 5 minutes
3. **Hash Matching**: Uses reflection text hash for matching
4. **Fallback Strategy**: IndexedDB → Supabase → Generate

## Security Considerations

- **User Isolation**: Audio data is stored per-user with proper access controls
- **Rate Limiting**: Per-user limits prevent abuse
- **Authentication**: All audio operations require valid session
- **Data Privacy**: Audio data is associated with hashed user IDs

## Future Improvements

1. **Multi-Segment Progressive Streaming**: Implement continuous streaming with multiple partial buffers
2. **Adaptive Format Selection**: Choose format based on connection speed
3. **Audio Compression**: Implement better compression while maintaining progressive capabilities
4. **Service Worker Caching**: Cache audio at network level for offline access

## Testing and Monitoring

The system includes comprehensive logging and monitoring:
- **Performance Metrics**: Time to first audio, download rates, buffer times
- **Error Tracking**: API failures, rate limits, network issues
- **Cache Performance**: Hit rates, storage usage, sync success rates
- **User Experience**: Playback start times, gap detection, quality metrics

## Conclusion

The audio streaming implementation in Serenity Journal provides a sophisticated solution for progressive audio playback with caching and synchronization. The system prioritizes user experience with fast playback start times while maintaining cross-device functionality. The main issue identified is the missing `optimizeAudio` function which needs to be implemented or removed to prevent runtime errors.