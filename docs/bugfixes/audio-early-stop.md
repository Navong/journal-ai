# Bugfix: Audio Playback Early Stop

## Issue
Audio playback was stopping early, especially with longer audio chunks (> 5 seconds).

## Root Cause
In `app/components/JournalApp.tsx`, the `playAudioChunk` function had a critical bug on line 876:

```javascript
}, Math.min(waitTime, 2500)); // Cap at 2.5 seconds max delay
```

### The Problem
The `onended` event for AudioBufferSourceNode often fires **1-3 seconds early** when playing compressed audio (WebM/MP3) from the database. The code compensated for this by calculating the remaining time and waiting before triggering the next chunk.

However, the wait time was capped at **2.5 seconds**. This caused audio to cut off early when:
- Audio duration > 5 seconds
- `onended` fires > 2.5 seconds early
- Result: Audio stops before completing

### Example Scenario
```
Audio duration: 8 seconds
onended fires after: 5 seconds (3 seconds early)
Remaining time: 8 - 5 = 3 seconds
Wait time with buffer: 3 + 0.15 = 3.15 seconds
After old cap: Math.min(3.15, 2.5) = 2.5 seconds ❌
Total playback: 5 + 2.5 = 7.5 seconds instead of 8 seconds
→ 0.5 seconds cut off
```

## Solution
1. **Removed the 2.5 second cap** that was causing premature stops
2. **Added a more reasonable 15 second cap** to handle extreme edge cases
3. **Improved logging** to show when capping occurs and track timing issues

### Updated Code
```javascript
// Wait for the full expected duration plus a small safety buffer
const waitTime = Math.max(0, remainingTime) + 150;

// Cap at 15 seconds (increased from 2.5s) to handle edge cases
const cappedWaitTime = Math.min(waitTime, 15000);

setTimeout(() => {
  // Trigger next chunk
}, cappedWaitTime);
```

## Testing
Test scenarios to verify the fix:
1. **Short audio (< 2s)**: Should play completely ✓
2. **Medium audio (3-5s)**: Should play completely ✓
3. **Long audio (6-10s)**: Should play completely ✓ (fixed by this patch)
4. **Multi-chunk audio**: All chunks should play sequentially without gaps ✓

## Files Changed
- `app/components/JournalApp.tsx` (lines 862-877)

## Impact
- ✅ Audio playback now completes fully
- ✅ No early cutoffs for longer audio segments
- ✅ Better handling of compressed audio timing issues
- ✅ Improved logging for debugging

## Date
January 2, 2026
