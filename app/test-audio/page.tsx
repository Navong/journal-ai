'use client';

import { useState, useRef, useEffect } from 'react';

export default function TestAudioPage() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [status, setStatus] = useState('Ready to test');
  const [logs, setLogs] = useState<string[]>([]);
  const [provider, setProvider] = useState<'cartesia' | 'murf' | 'elevenlabs' | 'fish'>('cartesia');
  const [textLength, setTextLength] = useState<'short' | 'long'>('short');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    const logMessage = `[${timestamp}] ${message}`;
    console.log(logMessage);
    setLogs(prev => [...prev, logMessage]);
  };

  // Convert raw PCM bytes to AudioBuffer for Web Audio API
  // PCM format: 16-bit signed integers, little-endian, mono
  const pcmToAudioBuffer = (pcmData: Uint8Array, audioContext: AudioContext, channels: number = 1): AudioBuffer => {
    // PCM is 16-bit (2 bytes per sample)
    const numSamples = Math.floor(pcmData.length / 2);
    const audioBuffer = audioContext.createBuffer(channels, numSamples, audioContext.sampleRate);

    // Convert 16-bit PCM to float32 (-1.0 to 1.0)
    const dataView = new DataView(pcmData.buffer, pcmData.byteOffset, pcmData.byteLength);
    const channelData = audioBuffer.getChannelData(0);

    for (let i = 0; i < numSamples; i++) {
      // Read 16-bit signed integer (little-endian)
      const int16Value = dataView.getInt16(i * 2, true);
      // Convert to float32 range (-1.0 to 1.0)
      channelData[i] = int16Value / 32768.0;
    }

    return audioBuffer;
  };

  const testAudioStreaming = async () => {
    try {
      setIsPlaying(true);
      setStatus('Starting test...');
      addLog('=== Audio Streaming Test Started ===');

      // Test texts (computed dynamically based on provider)
      const providerName = provider === 'cartesia' ? 'Cartesia' : provider === 'murf' ? 'Murf' : provider === 'elevenlabs' ? 'ElevenLabs' : 'Fish Audio';
      const shortText = `Hello! This is a comprehensive test of the audio streaming system. We are testing how quickly ${providerName} can generate speech and stream it back to the client.`;

      const longText = `Hello! This is a comprehensive test of the audio streaming system. We are testing how quickly ${providerName} can generate speech and stream it back to the client. The goal is to measure the time it takes from making the request to hearing the first audio, as well as the total time to complete playback. This longer sentence will help us understand the performance characteristics of the streaming implementation. Progressive audio playback is a critical feature for creating responsive user experiences. When users write journal entries and request AI reflections, they should not have to wait several seconds before hearing the response. By using WAV format instead of MP3, we can decode and play partial audio while the rest of the file is still downloading. This approach provides a much better user experience, allowing the audio to start playing within just two to three seconds, rather than waiting for the entire file to download. The seamless transition between the partial playback and the continuation ensures that users hear a continuous, uninterrupted reflection without any awkward gaps or overlapping audio. This is exactly the kind of polished experience that makes an application feel professional and well-designed.`;

      const testText = textLength === 'short' ? shortText : longText;
      addLog(`Test text length: ${textLength} (${testText.length} characters)`);
      addLog(`Test text: "${testText.substring(0, 100)}${testText.length > 100 ? '...' : ''}"`);

      // Fetch audio from API
      setStatus('Fetching audio from API...');
      addLog('Sending request to /api/tts');

      const requestStartTime = Date.now();
      addLog(`Using TTS provider: ${provider}`);
      addLog(`📤 Sending request to /api/tts at ${new Date().toLocaleTimeString()}`);

      const fetchStartTime = Date.now();
      // Add format parameter for PCM format
      const formatParam = provider === 'murf' ? 'pcm' : 'wav'; // Murf uses PCM, others use WAV/MP3
      const response = await fetch(`/api/tts?provider=${provider}&format=${formatParam}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: testText }),
      });

      const fetchTime = Date.now() - fetchStartTime;
      const totalTimeToResponse = Date.now() - requestStartTime;
      addLog(`⏱️ Response received: ${fetchTime}ms (total: ${totalTimeToResponse}ms from request start)`);
      addLog(`Status: ${response.status} ${response.statusText}`);
      addLog(`Content-Type: ${response.headers.get('Content-Type')}`);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `HTTP ${response.status}`);
      }

      // Check content type
      const contentType = response.headers.get('Content-Type') || '';
      const sampleRateHeader = response.headers.get('X-Audio-Sample-Rate');
      const sampleRate = sampleRateHeader ? parseInt(sampleRateHeader, 10) : 44100;
      const isPCM = contentType.includes('L16') || contentType.includes('pcm');
      addLog(`Received content type: ${contentType}${isPCM ? ` (PCM, ${sampleRate}Hz)` : ''}`);

      if (contentType.includes('audio/')) {
        // Binary streaming audio - PCM or WAV format
        setStatus(isPCM ? 'Setting up PCM audio playback...' : 'Setting up progressive audio playback...');
        addLog(isPCM ? 'Detected binary audio stream (PCM format - raw, uncompressed)' : 'Detected binary audio stream (WAV format)');
        if (isPCM) {
          addLog('PCM format: Lowest latency, uncompressed, largest payload size');
        } else {
          addLog('Attempting progressive WAV playback...');
        }

        const streamStartTime = Date.now();

        // Read stream and collect chunks
        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error('No response body reader available');
        }

        const chunks: Uint8Array[] = [];
        let totalBytes = 0;
        let chunkCount = 0;
        // Buffer size: 1MB per segment for progressive playback
        // Split into multiple segments (3+) to handle stream slowdowns better
        const SEGMENT_SIZE = 1024 * 1024; // 1MB per segment
        const MAX_SEGMENTS = 10; // Maximum number of segments to create (safety limit)
        let firstChunkTime: number | null = null;
        let firstChunkSentTime: number | null = null;

        addLog(isPCM ? '📥 Reading PCM chunks from stream...' : '📥 Reading WAV chunks from stream...');

        // Read chunks and attempt progressive playback with multiple segments
        let audioContext: AudioContext | null = null;
        let earlyPlaybackStarted = false;
        let segmentIndex = 0; // Track current segment number
        let segmentDurations: number[] = []; // Track duration of each segment
        let segmentChunkCounts: number[] = []; // Track chunk count per segment
        let lastPlaybackPromise: Promise<void> | null = null; // Promise for last segment playback
        let segmentProcessingPromise: Promise<void> = Promise.resolve(); // Chain segment processing sequentially

        while (true) {
          const chunkReadStart = Date.now();
          const { done, value } = await reader.read();
          const chunkReadTime = Date.now() - chunkReadStart;

          if (done) {
            addLog('✅ All chunks received');
            break;
          }

          if (value) {
            if (firstChunkTime === null) {
              firstChunkTime = Date.now();
              const timeToFirstChunk = firstChunkTime - requestStartTime;
              const timeFromResponse = firstChunkTime - (requestStartTime + fetchTime);
              addLog(`⚡ First chunk received: ${timeToFirstChunk}ms from request start (${timeFromResponse}ms from response, read: ${chunkReadTime}ms, size: ${value.length} bytes)`);
            }

            chunks.push(value);
            totalBytes += value.length;
            chunkCount++;

            if (firstChunkSentTime === null) {
              firstChunkSentTime = Date.now();
              const timeToFirstChunkSent = firstChunkSentTime - requestStartTime;
              addLog(`🎵 First chunk processed: ${timeToFirstChunkSent}ms from request start`);
            }

            // Calculate and log speed metrics
            const elapsed = Date.now() - streamStartTime;
            const rate = (totalBytes / 1024) / (elapsed / 1000);
            const avgRate = (totalBytes / 1024) / ((Date.now() - requestStartTime) / 1000);

            if (chunkCount <= 5 || chunkCount % 50 === 0) {
              addLog(`📦 Chunk ${chunkCount}: ${value.length} bytes, total: ${(totalBytes / 1024).toFixed(1)}KB, rate: ${rate.toFixed(2)}KB/s (avg: ${avgRate.toFixed(2)}KB/s, read: ${chunkReadTime}ms)`);
            }

            // Progressive multi-segment playback: Play segments as they're buffered
            // Check if we've reached the threshold for the next segment (1MB per segment)
            const currentSegmentThreshold = (segmentIndex + 1) * SEGMENT_SIZE;
            if (segmentIndex < MAX_SEGMENTS && totalBytes >= currentSegmentThreshold) {
              const segmentNum = segmentIndex + 1;
              segmentIndex++; // Increment immediately to prevent race conditions
              const bufferTime = Date.now() - streamStartTime;
              const totalTimeToBuffer = Date.now() - requestStartTime;
              const bufferRate = (totalBytes / 1024) / (bufferTime / 1000);
              addLog(`✅ Segment ${segmentNum} ready: ${(totalBytes / 1024).toFixed(1)}KB buffered in ${bufferTime}ms (rate: ${bufferRate.toFixed(2)}KB/s), preparing playback...`);

              // Process segment sequentially - chain to previous segment processing to prevent overlap
              segmentProcessingPromise = segmentProcessingPromise.then(async () => {
                try {
                  // Calculate segment boundaries (segmentNum is 1-based, so subtract 1 for 0-based index)
                  const segmentZeroBasedIndex = segmentNum - 1;
                  const segmentStartByte = segmentZeroBasedIndex * SEGMENT_SIZE;
                  const segmentEndByte = Math.min(totalBytes, segmentNum * SEGMENT_SIZE);
                  const segmentLength = segmentEndByte - segmentStartByte;

                  // Combine all chunks into a single buffer first
                  const allChunksLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
                  const allChunksBuffer = new Uint8Array(allChunksLength);
                  let offset = 0;
                  for (const chunk of chunks) {
                    allChunksBuffer.set(chunk, offset);
                    offset += chunk.length;
                  }

                  // Extract this segment's byte range
                  const segmentBuffer = allChunksBuffer.slice(segmentStartByte, segmentEndByte);
                  const segmentChunkCount = chunks.length; // Approximate - actual count is complex to calculate

                  addLog(`📊 Segment ${segmentNum}: ${(segmentLength / 1024).toFixed(1)}KB (bytes ${segmentStartByte}-${segmentEndByte} of ${allChunksLength})`);

                  // Yield to event loop
                  await new Promise(resolve => setTimeout(resolve, 0));

                  // Create AudioContext if needed
                  if (!audioContext) {
                    audioContext = new AudioContext({ sampleRate });
                    if (audioContext.state === 'suspended') {
                      await audioContext.resume();
                    }
                    addLog(`AudioContext created (state: ${audioContext.state}, sampleRate: ${audioContext.sampleRate}Hz)`);
                  }

                  // Convert/decode segment
                  let audioBuffer: AudioBuffer;
                  if (isPCM) {
                    const convertStart = Date.now();
                    audioBuffer = pcmToAudioBuffer(segmentBuffer, audioContext, 1);
                    const convertTime = Date.now() - convertStart;
                    addLog(`✅ Segment ${segmentNum} PCM converted in ${convertTime}ms! Duration: ${audioBuffer.duration.toFixed(2)}s`);
                  } else {
                    audioBuffer = await audioContext.decodeAudioData(segmentBuffer.buffer.slice(0));
                    addLog(`✅ Segment ${segmentNum} WAV decoded! Duration: ${audioBuffer.duration.toFixed(2)}s`);
                  }

                  const segmentDuration = audioBuffer.duration;
                  segmentDurations.push(segmentDuration);
                  segmentChunkCounts.push(segmentChunkCount);

                  // Play segment - chain it after the previous segment
                  const playSegment = async () => {
                    return new Promise<void>((resolve) => {
                      const source = audioContext!.createBufferSource();
                      source.buffer = audioBuffer;
                      source.connect(audioContext!.destination);

                      if (segmentNum === 1) {
                        const playTime = Date.now() - requestStartTime;
                        addLog(`🎵 Segment ${segmentNum} PLAYBACK STARTED in ${playTime}ms from request start`);
                        setStatus(`Playing audio (segment ${segmentNum}, progressive playback)...`);
                        earlyPlaybackStarted = true;
                      } else {
                        addLog(`🎵 Segment ${segmentNum} PLAYBACK STARTED (chained after segment ${segmentNum - 1})`);
                        setStatus(`Playing audio (segment ${segmentNum}/${Math.ceil(totalBytes / SEGMENT_SIZE)}, progressive playback)...`);
                      }

                      source.onended = () => {
                        addLog(`✅ Segment ${segmentNum} ended (${segmentDuration.toFixed(2)}s played)`);
                        resolve();
                      };

                      source.start(0);
                    });
                  };

                  // Wait for previous segment to finish (if any), then play this one
                  if (lastPlaybackPromise) {
                    await lastPlaybackPromise;
                  }
                  lastPlaybackPromise = playSegment();

                } catch (error: any) {
                  addLog(`⚠️ Segment ${segmentNum} playback failed: ${error.message}`);
                }
              });
            }

            // Yield briefly to event loop every 10 chunks to prevent blocking
            // This helps stream reading continue even when audio playback is active
            if (chunkCount % 10 === 0) {
              await Promise.resolve(); // Microtask yield - lower latency than setTimeout
            }
          }
        }

        const streamTime = Date.now() - streamStartTime;
        const totalTime = Date.now() - requestStartTime;
        const finalRate = (totalBytes / 1024) / (streamTime / 1000);
        const avgRate = (totalBytes / 1024) / (totalTime / 1000);
        addLog(`📊 Stream complete: ${chunkCount} chunks, ${(totalBytes / 1024).toFixed(1)}KB in ${streamTime}ms`);
        addLog(`⏱️ Performance: ${finalRate.toFixed(2)}KB/s streaming rate, ${avgRate.toFixed(2)}KB/s average`);
        addLog(`⏱️ Total latency: ${totalTime}ms from request start (fetch: ${fetchTime}ms, stream: ${streamTime}ms)`);

        if (firstChunkTime) {
          const timeToFirstAudio = firstChunkTime - requestStartTime;
          addLog(`🚀 Time to first audio chunk: ${timeToFirstAudio}ms`);
        }

        // ALWAYS play complete audio after stream finishes (even if partial played)
        setStatus('Decoding complete audio...');

        // Combine all chunks for final playback
        const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
        const completeChunkCount = chunks.length;
        const totalSegmentsPlayed = segmentIndex;
        addLog(`📊 Complete buffer: ${completeChunkCount} chunks total, ${(totalLength / 1024).toFixed(1)}KB total`);
        if (earlyPlaybackStarted && totalSegmentsPlayed > 0) {
          const totalSegmentBytes = totalSegmentsPlayed * SEGMENT_SIZE;
          const remainingBytes = totalLength - totalSegmentBytes;
          addLog(`   └─ Segments played: ${totalSegmentsPlayed} segments (${(totalSegmentBytes / 1024).toFixed(0)}KB)`);
          addLog(`   └─ Remaining: ${(remainingBytes / 1024).toFixed(0)}KB`);
        }
        const completeBuffer = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
          completeBuffer.set(chunk, offset);
          offset += chunk.length;
        }

        addLog(`Combined ${(totalLength / 1024).toFixed(1)}KB ${isPCM ? 'PCM' : 'WAV'} data`);

        // Create AudioContext if not already created
        if (!audioContext) {
          audioContext = new AudioContext({ sampleRate: isPCM ? sampleRate : undefined });
          if (audioContext.state === 'suspended') {
            await audioContext.resume();
          }
          addLog(`AudioContext created (state: ${audioContext.state}, sampleRate: ${audioContext.sampleRate}Hz)`);
        }

        // Decode/convert complete audio
        const decodeStart = Date.now();
        let completeAudioBuffer: AudioBuffer;
        if (isPCM) {
          // Convert raw PCM to AudioBuffer (no decoding needed - direct conversion)
          completeAudioBuffer = pcmToAudioBuffer(completeBuffer, audioContext, 1);
        } else {
          // Decode WAV format
          completeAudioBuffer = await audioContext.decodeAudioData(completeBuffer.buffer.slice(0));
        }
        const decodeTime = Date.now() - decodeStart;

        addLog(`🔊 Complete audio ${isPCM ? 'converted' : 'decoded'} in ${decodeTime}ms`);
        addLog(`📈 Audio stats: Duration: ${completeAudioBuffer.duration.toFixed(2)}s, Sample rate: ${completeAudioBuffer.sampleRate}Hz, Channels: ${completeAudioBuffer.numberOfChannels}`);

        const totalTimeToDecode = Date.now() - requestStartTime;
        const decodeRate = (totalLength / 1024) / (totalTimeToDecode / 1000);
        addLog(`⏱️ Time to decode: ${totalTimeToDecode}ms from request start (decode rate: ${decodeRate.toFixed(2)}KB/s)`);

        // Play complete audio from where partial left off
        const source = audioContext.createBufferSource();
        source.buffer = completeAudioBuffer;
        source.connect(audioContext.destination);

        source.onended = () => {
          const totalTime = Date.now() - requestStartTime;
          const playbackDuration = completeAudioBuffer.duration * 1000;
          addLog(`🏁 Playback ended. Total time: ${totalTime}ms from request start`);
          addLog(`📊 Summary: Audio duration: ${playbackDuration.toFixed(0)}ms, Total latency: ${totalTime}ms, Efficiency: ${((playbackDuration / totalTime) * 100).toFixed(1)}%`);
          setStatus('Test completed successfully! ✅');
          setIsPlaying(false);
        };

        if (earlyPlaybackStarted) {
          // Wait for all segment processing AND playback to finish before starting final playback
          addLog(`Waiting for ${totalSegmentsPlayed} segment(s) to finish processing and playback...`);
          await segmentProcessingPromise; // Wait for all segment processing to complete
          if (lastPlaybackPromise) {
            await lastPlaybackPromise; // Wait for all segment playback to complete
          }
          addLog('All segments finished, starting final playback...');

          // Calculate total duration of segments played so far
          const totalSegmentDuration = segmentDurations.reduce((sum, duration) => sum + duration, 0);
          addLog(`▶️ Playing remaining audio from ${totalSegmentDuration.toFixed(2)}s (${totalSegmentsPlayed} segments already played)...`);
          setStatus('Playing remaining audio...');
          source.start(0, totalSegmentDuration);
        } else {
          // Play from beginning
          const playTime = Date.now() - requestStartTime;
          addLog(`🎵 PLAYBACK STARTED in ${playTime}ms from initial request`);
          setStatus('Playing complete audio...');
          source.start(0);
        }

      } else {
        // JSON response (fallback) - use HTML5 audio with data URL
        addLog('Detected JSON response (fallback mode)');
        const data = await response.json();

        if (!data.audioData) {
          throw new Error('No audioData in response');
        }

        addLog(`Received base64 audio: ${data.audioData.length} characters`);

        // Create audio element if not exists
        if (!audioRef.current) {
          audioRef.current = new Audio();
        }

        const audio = audioRef.current;

        audio.onended = () => {
          setStatus('Test completed successfully! ✅');
          setIsPlaying(false);
        };

        // Use data URL for base64 audio
        audio.src = `data:audio/mpeg;base64,${data.audioData}`;
        addLog('Set audio source from base64 data URL');

        await audio.play();
        addLog('Started playback');
        setStatus('Playing audio...');
      }

    } catch (error: any) {
      console.error('Test failed:', error);
      addLog(`❌ ERROR: ${error.message}`);
      setStatus(`Error: ${error.message}`);
      setIsPlaying(false);
    }
  };

  const stopAudio = () => {
    if (audioRef.current) {
      try {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
        addLog('Audio stopped by user');
      } catch (e) {
        // Already stopped
      }
    }
    setIsPlaying(false);
    setStatus('Stopped');
  };

  const clearLogs = () => {
    setLogs([]);
    setStatus('Ready to test');
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
      }
    };
  }, []);

  return (
    <div style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto' }}>
      <h1 style={{ marginBottom: '1rem' }}>Audio Streaming Test</h1>

      <div style={{ marginBottom: '2rem', padding: '1rem', background: '#f5f5f5', borderRadius: '8px' }}>
        <p style={{ margin: 0, fontWeight: 'bold', marginBottom: '0.5rem' }}>TTS Provider:</p>
        <div style={{ marginBottom: '1rem', display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
            <input
              type="radio"
              value="cartesia"
              checked={provider === 'cartesia'}
              onChange={(e) => setProvider(e.target.value as 'cartesia' | 'murf' | 'elevenlabs' | 'fish')}
              disabled={isPlaying}
              style={{ marginRight: '0.5rem' }}
            />
            Cartesia
          </label>
          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
            <input
              type="radio"
              value="murf"
              checked={provider === 'murf'}
              onChange={(e) => setProvider(e.target.value as 'cartesia' | 'murf' | 'elevenlabs' | 'fish')}
              disabled={isPlaying}
              style={{ marginRight: '0.5rem' }}
            />
            Murf.ai (Gen2)
          </label>
          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
            <input
              type="radio"
              value="elevenlabs"
              checked={provider === 'elevenlabs'}
              onChange={(e) => setProvider(e.target.value as 'cartesia' | 'murf' | 'elevenlabs' | 'fish')}
              disabled={isPlaying}
              style={{ marginRight: '0.5rem' }}
            />
            ElevenLabs
          </label>
          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
            <input
              type="radio"
              value="fish"
              checked={provider === 'fish'}
              onChange={(e) => setProvider(e.target.value as 'cartesia' | 'murf' | 'elevenlabs' | 'fish')}
              disabled={isPlaying}
              style={{ marginRight: '0.5rem' }}
            />
            Fish Audio (S1)
          </label>
        </div>
        <p style={{ margin: 0, fontWeight: 'bold', marginBottom: '0.5rem' }}>Text Length:</p>
        <div style={{ marginBottom: '1rem', display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
            <input
              type="radio"
              value="short"
              checked={textLength === 'short'}
              onChange={(e) => setTextLength(e.target.value as 'short' | 'long')}
              disabled={isPlaying}
              style={{ marginRight: '0.5rem' }}
            />
            Short
          </label>
          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
            <input
              type="radio"
              value="long"
              checked={textLength === 'long'}
              onChange={(e) => setTextLength(e.target.value as 'short' | 'long')}
              disabled={isPlaying}
              style={{ marginRight: '0.5rem' }}
            />
            Long
          </label>
        </div>
        <p style={{ margin: 0, fontWeight: 'bold' }}>Test Text:</p>
        <div style={{ margin: '0.5rem 0', fontStyle: 'italic', fontSize: '0.85rem', maxHeight: '120px', overflowY: 'auto', padding: '0.5rem', background: '#fff', borderRadius: '4px' }}>
          {(() => {
            const providerName = provider === 'cartesia' ? 'Cartesia' : provider === 'murf' ? 'Murf' : provider === 'elevenlabs' ? 'ElevenLabs' : 'Fish Audio';
            const short = `Hello! This is a comprehensive test of the audio streaming system. We are testing how quickly ${providerName} can generate speech and stream it back to the client.`;
            const long = `Hello! This is a comprehensive test of the audio streaming system. We are testing how quickly ${providerName} can generate speech and stream it back to the client. The goal is to measure the time it takes from making the request to hearing the first audio, as well as the total time to complete playback. This longer sentence will help us understand the performance characteristics of the streaming implementation. Progressive audio playback is a critical feature for creating responsive user experiences. When users write journal entries and request AI reflections, they should not have to wait several seconds before hearing the response. By using WAV format instead of MP3, we can decode and play partial audio while the rest of the file is still downloading. This approach provides a much better user experience, allowing the audio to start playing within just two to three seconds, rather than waiting for the entire file to download. The seamless transition between the partial playback and the continuation ensures that users hear a continuous, uninterrupted reflection without any awkward gaps or overlapping audio. This is exactly the kind of polished experience that makes an application feel professional and well-designed.`;
            return `"${textLength === 'short' ? short : long}"`;
          })()}
        </div>
      </div>

      <div style={{ marginBottom: '2rem' }}>
        <p style={{ margin: '0 0 0.5rem 0', fontWeight: 'bold' }}>Status:</p>
        <p style={{
          margin: 0,
          padding: '0.75rem',
          background: isPlaying ? '#fff3cd' : '#d4edda',
          border: `1px solid ${isPlaying ? '#ffc107' : '#28a745'}`,
          borderRadius: '4px'
        }}>
          {status}
        </p>
      </div>

      <div style={{ marginBottom: '2rem', display: 'flex', gap: '1rem' }}>
        <button
          onClick={testAudioStreaming}
          disabled={isPlaying}
          style={{
            padding: '0.75rem 1.5rem',
            fontSize: '1rem',
            background: isPlaying ? '#ccc' : '#007bff',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: isPlaying ? 'not-allowed' : 'pointer',
          }}
        >
          {isPlaying ? 'Testing...' : 'Start Test'}
        </button>

        <button
          onClick={stopAudio}
          disabled={!isPlaying}
          style={{
            padding: '0.75rem 1.5rem',
            fontSize: '1rem',
            background: !isPlaying ? '#ccc' : '#dc3545',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: !isPlaying ? 'not-allowed' : 'pointer',
          }}
        >
          Stop
        </button>

        <button
          onClick={clearLogs}
          style={{
            padding: '0.75rem 1.5rem',
            fontSize: '1rem',
            background: '#6c757d',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
          }}
        >
          Clear Logs
        </button>
      </div>

      <div style={{
        background: '#000',
        color: '#0f0',
        padding: '1rem',
        borderRadius: '4px',
        fontFamily: 'monospace',
        fontSize: '0.875rem',
        maxHeight: '400px',
        overflowY: 'auto'
      }}>
        <p style={{ margin: '0 0 0.5rem 0', fontWeight: 'bold', color: '#fff' }}>
          Debug Logs:
        </p>
        {logs.length === 0 ? (
          <p style={{ margin: 0, color: '#888' }}>No logs yet. Click "Start Test" to begin.</p>
        ) : (
          logs.map((log, index) => (
            <div key={index} style={{ marginBottom: '0.25rem' }}>
              {log}
            </div>
          ))
        )}
      </div>

      <div style={{ marginTop: '2rem', padding: '1rem', background: '#e7f3ff', borderRadius: '4px' }}>
        <h3 style={{ marginTop: 0 }}>What This Tests:</h3>
        <ul style={{ marginBottom: 0 }}>
          <li>API request to /api/tts</li>
          <li><strong>MP3/WAV streaming from Cartesia, Murf.ai, ElevenLabs, or Fish Audio</strong></li>
          <li>Progressive playback with Web Audio API</li>
          <li>Early playback after buffering 512KB (all providers)</li>
          <li>Time to first audio (target: 2-3s)</li>
          <li>Minimal or no gap before continuation</li>
        </ul>
        <p style={{ marginTop: '1rem', fontSize: '0.9rem', color: '#666' }}>
          <strong>Providers:</strong> Select between Cartesia, Murf.ai, ElevenLabs, or Fish Audio to compare performance and quality.
          <br />• <strong>Cartesia:</strong> True streaming - chunks arrive progressively (~2-3s to first audio)
          <br />• <strong>Murf.ai (Gen2):</strong> Studio-quality speech synthesis with Miles voice (Calm style) - supports streaming
          <br />• <strong>ElevenLabs:</strong> High-quality TTS with ultra-low latency models - supports streaming
          <br />• <strong>Fish Audio (S1):</strong> Latest model with emotion control and voice cloning - balanced latency mode (~300ms)
        </p>
        <p style={{ marginTop: '0.5rem', fontSize: '0.9rem', color: '#666' }}>
          <strong>Progressive Playback:</strong> Buffers 512KB (~2-3 seconds of audio) for all providers before starting playback. All providers support true streaming with progressive chunk delivery.
        </p>
        <p style={{ marginTop: '0.5rem', fontSize: '0.9rem', color: '#666' }}>
          <strong>Performance:</strong> Starts playing in 2-3 seconds, then plays continuously through to the end with seamless transition when the full audio takes over.
        </p>
      </div>
    </div>
  );
}
