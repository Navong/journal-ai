# TTS Provider Performance Comparison

This document tracks performance metrics for different TTS providers to help compare latency, speed, and quality.

## Test Configuration

- **Test Date**: 2024-12-XX
- **Test Environment**: Browser-based streaming test
- **Audio Format**: WAV, 44.1kHz, Mono
- **Test Text**: Long text (~500+ characters)

## Murf.ai (Gen2 Model - Miles Voice, Calm Style)

**Test Date**: 2024-12-XX 19:56:07

### Performance Metrics

| Metric | Value |
|--------|-------|
| **Time to First Audio Chunk** | 1,517ms (1.52s) |
| **Total Request Latency** | 15,417ms (15.42s) |
| **Fetch Time** | 1,503ms (1.50s) |
| **Stream Time** | 13,912ms (13.91s) |
| **Decode Time** | 35ms |
| **Total Chunks** | 521 |
| **Total Size** | 7,970.8KB (~7.8MB) |
| **Streaming Rate** | 572.94KB/s |
| **Average Rate** | 517.01KB/s |
| **Decode Rate** | 515.67KB/s |
| **Audio Duration** | 92.54s |
| **Sample Rate** | 44,100Hz |
| **Channels** | 1 (Mono) |

### Breakdown

- **Request → First Chunk**: 1,517ms
- **First Chunk → Stream Complete**: 13,912ms
- **Stream Complete → Decoded**: 35ms
- **Total Time**: 15,417ms

### Observations

- First chunk arrives relatively quickly (~1.5s)
- Streaming rate is consistent (~570KB/s)
- Large file size (7.8MB for ~92s of audio)
- Decode time is very fast (35ms)

---

## Cartesia

**Test Date**: TBD

### Performance Metrics

| Metric | Value |
|--------|-------|
| **Time to First Audio Chunk** | TBD |
| **Total Request Latency** | TBD |
| **Fetch Time** | TBD |
| **Stream Time** | TBD |
| **Decode Time** | TBD |
| **Total Chunks** | TBD |
| **Total Size** | TBD |
| **Streaming Rate** | TBD |
| **Average Rate** | TBD |
| **Decode Rate** | TBD |
| **Audio Duration** | TBD |
| **Sample Rate** | TBD |
| **Channels** | TBD |

---

## Comparison Summary

| Metric | Murf.ai | Cartesia | Winner |
|--------|---------|----------|--------|
| Time to First Chunk | 1,517ms | TBD | TBD |
| Total Latency | 15,417ms | TBD | TBD |
| Streaming Rate | 572.94KB/s | TBD | TBD |
| Decode Time | 35ms | TBD | TBD |
| File Size Efficiency | 7.8MB/92s | TBD | TBD |

---

## Notes

- All times are in milliseconds (ms)
- Rates are in KB/s (kilobytes per second)
- File sizes are in KB (kilobytes)
- Audio duration is in seconds (s)

