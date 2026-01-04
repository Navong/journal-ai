# Audio Streaming Implementation - Technical Documentation

## Overview

This document details the implementation of progressive audio streaming for TTS (Text-to-Speech) in the Serenity Journal application using Cartesia AI's API.

## Problem Statement

**Initial Issue:** Users had to wait 5-6 seconds before hearing audio playback when requesting AI reflections.

**Root Cause:** MP3 format requires the complete file to be downloaded before browsers can play it (no progressive decoding support).

## Solutions Attempted

### 1. ❌ MP3 with MediaSource Extensions API (FAILED)

**Approach:** Use MediaSource API to stream MP3 chunks progressively.

**Implementation:**
```javascript
const mediaSource = new MediaSource();
const sourceBuffer = mediaSource.addSourceBuffer('audio/mpeg');
// Append chunks as they arrive
sourceBuffer.appendBuffer(chunk);
```

**Result:** FAILED - MediaSource API doesn't support raw MP3 streaming well. It requires fragmented MP4 or similar containerized formats. The stream got stuck after the first chunk.

**File:** `app/test-audio/page.tsx` (reverted)

### 2. ❌ MP3 with Blob URL (BASELINE)

**Approach:** Download entire MP3, create blob URL, play with HTML5 Audio element.

**Implementation:**
```javascript
const blob = await response.blob();
const blobUrl = URL.createObjectURL(blob);
audio.src = blobUrl;
await audio.play();
```

**Performance:**
- Response time: 600-1000ms
- Download time: 5-6 seconds (400KB @ 4x real-time)
- **Time to playback: 5.8-6 seconds**

**Limitations:**
- Users wait for complete download
- No progressive playback possible
- Standard browser limitation with MP3

**File:** `app/test-audio/page.tsx` (intermediate version)

### 3. ✅ WAV/PCM with Progressive Decoding (SUCCESS)

**Approach:** Switch to WAV format with partial buffer playback.

**Why WAV?**
- Uncompressed PCM audio
- Can be decoded partially (doesn't need complete file)
- Web Audio API `decodeAudioData()` works on partial WAV data

**Implementation:**

#### Backend (API Route)
```javascript
// app/api/tts/route.ts
const outputFormat = {
    container: 'wav' as const,
    encoding: 'pcm_f32le' as const,
    sampleRate: 44100,
};

return new Response(stream, {
    headers: {
        'Content-Type': 'audio/wav',
    },
});
```

#### Frontend (Progressive Playback)
```javascript
// app/test-audio/page.tsx
const MIN_BUFFER_FOR_PLAYBACK = 1536 * 1024; // 1.5MB (~8-9 seconds)

// Read chunks
while (true) {
    const { done, value } = await reader.read();
    chunks.push(value);
    totalBytes += value.length;

    // Once buffered enough, play partial audio
    if (totalBytes >= MIN_BUFFER_FOR_PLAYBACK && !playbackStarted) {
        const partialBuffer = combineChunks(chunks);
        const audioBuffer = await audioContext.decodeAudioData(partialBuffer);

        // Play partial
        const source = audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.start(0);

        // Track when partial ends
        partialEndedPromise = new Promise(resolve => {
            source.onended = resolve;
        });
    }
}

// After stream completes, wait for partial to end
await partialEndedPromise;

// Play remaining audio from where partial left off
const completeBuffer = combineChunks(chunks);
const completeAudioBuffer = await audioContext.decodeAudioData(completeBuffer);
source.buffer = completeAudioBuffer;
source.start(0, partialDuration); // Skip already-played portion
```

**Performance (25s audio):**
- Response time: 600-1000ms
- Buffer time: 2-3 seconds (1.5MB)
- **Time to playback: 2-3 seconds** ✅
- Stream completes: ~6 seconds
- Seamless continuation: 0 gap

**Performance (72s audio - long text):**
- Response time: 829ms
- Buffer time: 2.5 seconds (1.5MB)
- **Time to playback: 3.3 seconds** ✅
- Partial plays: 8.92 seconds
- Stream completes: 17 seconds
- **Gap before continuation: 6 seconds** ⚠️
- Total duration: 72.72 seconds

## Final Implementation Details

### Key Files

1. **`app/api/tts/route.ts`** - Backend API endpoint
   - Configured Cartesia to output WAV/PCM format
   - Streams binary audio chunks
   - Content-Type: `audio/wav`

2. **`app/test-audio/page.tsx`** - Test page with progressive playback
   - Buffers 1.5MB before starting playback
   - Plays partial audio while downloading
   - Waits for partial to end, then continues seamlessly

### Configuration

**Cartesia Output Format:**
```javascript
{
    container: 'wav',
    encoding: 'pcm_f32le',  // PCM float32 little-endian
    sampleRate: 44100,       // CD quality
}
```

**Buffer Size:** 1.5MB (1536 * 1024 bytes)
- Provides ~8-9 seconds of audio at 44.1kHz
- Balances quick start vs. smooth continuation

### Audio Format Comparison

| Format | File Size (25s) | Time to Play | Progressive? | Quality |
|--------|-----------------|--------------|--------------|---------|
| MP3    | ~400KB          | 5-6s         | ❌ No        | Good    |
| WAV    | ~4MB            | 2-3s         | ✅ Yes       | Excellent |

**Trade-off:** 10x larger files for 2-3x faster playback start.

## Issues & Solutions

### Issue 1: Audio Overlap
**Problem:** Partial and continuation played simultaneously.

**Cause:** Started continuation immediately when stream finished, without waiting for partial to end.

**Solution:**
```javascript
// Create promise that resolves when partial ends
partialEndedPromise = new Promise(resolve => {
    source.onended = resolve;
});

// Wait before starting continuation
await partialEndedPromise;
source.start(0, partialDuration);
```

### Issue 2: Gap Between Segments (Long Audio)
**Problem:** 6-second silence gap for 72-second audio.

**Cause:**
- Partial plays 8.92s
- Stream takes 17s to complete
- Wait 6 seconds after partial ends

**Current Status:** Known limitation - only one partial buffer.

**Potential Solution (Not Implemented):**
- Continuous progressive streaming with multiple partial buffers
- More complex implementation
- Would eliminate gaps entirely

## Performance Metrics

### Short Text (~25 seconds audio)
- API Response: 600-1000ms
- Download: 6 seconds (4MB @ 4x real-time)
- **Time to First Audio: 2-3 seconds** ✅
- Partial Duration: ~8-9 seconds
- Gap: 0-1 seconds (stream completes before partial ends)

### Long Text (~72 seconds audio)
- API Response: 829ms
- Download: 17 seconds (12.5MB @ 4x real-time)
- **Time to First Audio: 3.3 seconds** ✅
- Partial Duration: 8.92 seconds
- Gap: **6 seconds** ⚠️

## Limitations & Considerations

### File Size
WAV files are **10x larger** than MP3:
- 25s audio: 4MB (vs 400KB MP3)
- 72s audio: 12.5MB (vs 1.2MB MP3)

**Impact:**
- Higher bandwidth usage
- Slower on slow connections
- More storage if caching

### Gap in Long Audio
For audio longer than ~20 seconds, there will be a gap between partial and continuation.

**Workarounds:**
1. Increase buffer size (trade-off: slower initial start)
2. Implement multi-segment progressive streaming (complex)
3. Use sentence batching (multiple API calls = rate limits)

### Browser Compatibility
Web Audio API `decodeAudioData()` on partial WAV requires:
- Modern browsers (Chrome 14+, Firefox 25+, Safari 6+)
- May not work on very old browsers

## Recommendations

### For Production Use

**Short Reflections (<30s):**
- ✅ Use current WAV progressive streaming
- Excellent user experience
- Minimal/no gaps

**Long Reflections (>60s):**
- Consider hybrid approach:
  - WAV for first 30 seconds (fast start)
  - Switch to MP3 for remainder (smaller size)
- Or: Implement continuous progressive streaming

**Bandwidth-Constrained Users:**
- Detect slow connections
- Fall back to MP3 (smaller but slower start)
- Trade file size for user experience

### Future Improvements

1. **Multi-Segment Progressive Streaming**
   - Buffer and play continuously
   - No gaps regardless of length
   - More complex implementation

2. **Adaptive Format Selection**
   - Fast connections: WAV
   - Slow connections: MP3
   - Based on network speed detection

3. **Hybrid Streaming**
   - First chunk: WAV (fast start)
   - Remaining: MP3 (efficient)
   - Best of both worlds

4. **Audio Compression**
   - Use FLAC or Opus instead of raw PCM
   - Better compression than MP3
   - Still supports progressive decoding

## Code References

### Key Functions

**Backend - TTS Generation:**
- File: `app/api/tts/route.ts`
- Lines: 101-106 (output format configuration)
- Lines: 233-240 (response headers)

**Frontend - Progressive Playback:**
- File: `app/test-audio/page.tsx`
- Lines: 72 (buffer size configuration)
- Lines: 99-148 (partial playback logic)
- Lines: 205-224 (continuation logic)

### Related Services

**Production Implementation:**
- File: `app/services/geminiService.ts`
- Function: `generateSpeech()` - Needs update to match test implementation
- Current: Still uses base64 conversion (old approach)
- TODO: Update to use WAV streaming

**Frontend Playback:**
- File: `app/components/JournalApp.tsx`
- Function: `handleHistoryAudioPlayback()` - Audio playback in main app
- Current: Uses Web Audio API with base64 decoding
- TODO: Update to use progressive WAV streaming

## Migration Path

To use WAV streaming in production:

1. **Update Backend** ✅ (Already done in test route)
   - Format: MP3 → WAV
   - Encoding: Add `pcm_f32le`
   - Content-Type: `audio/mpeg` → `audio/wav`

2. **Update Frontend Service**
   - File: `app/services/geminiService.ts`
   - Remove base64 conversion
   - Use direct binary streaming
   - Implement progressive buffer playback

3. **Update Main App Component**
   - File: `app/components/JournalApp.tsx`
   - Replace blob-based playback
   - Add progressive streaming logic
   - Handle partial/continuation sequences

4. **Update Caching**
   - File: `app/utils/audioCache.ts`
   - Store WAV instead of MP3
   - Update size limits (larger files)

5. **Test & Monitor**
   - Bandwidth usage (will increase 10x)
   - User experience (faster playback start)
   - Performance on slow connections

## Conclusion

**Success:** Achieved **2-3x faster playback start** (from 5-6s to 2-3s) by switching from MP3 to WAV with progressive streaming.

**Trade-off:** 10x larger files is acceptable for better UX in a journaling app where responsiveness matters.

**Next Steps:**
- Decide if gap in long audio is acceptable
- Consider implementing continuous progressive streaming if needed
- Roll out to production with monitoring

## Test Page

Location: `/test-audio`

URL: `http://localhost:3000/test-audio`

Use this page to:
- Test different text lengths
- Measure performance metrics
- Verify seamless playback
- Check for gaps or overlaps

---

**Document Version:** 1.0
**Last Updated:** 2026-01-04
**Author:** Claude Code Implementation
