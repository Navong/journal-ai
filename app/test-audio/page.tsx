'use client';

import { useState, useRef, useEffect } from 'react';

export default function TestAudioPage() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [status, setStatus] = useState('Ready to test');
  const [logs, setLogs] = useState<string[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  const addLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    const logMessage = `[${timestamp}] ${message}`;
    console.log(logMessage);
    setLogs(prev => [...prev, logMessage]);
  };

  const testAudioStreaming = async () => {
    try {
      setIsPlaying(true);
      setStatus('Starting test...');
      addLog('=== Audio Streaming Test Started ===');

      const testText = 'Hello! This is a comprehensive test of the audio streaming system. We are testing how quickly Cartesia can generate speech and stream it back to the client. The goal is to measure the time it takes from making the request to hearing the first audio, as well as the total time to complete playback. This longer sentence will help us understand the performance characteristics of the streaming implementation. Progressive audio playback is a critical feature for creating responsive user experiences. When users write journal entries and request AI reflections, they should not have to wait several seconds before hearing the response. By using WAV format instead of MP3, we can decode and play partial audio while the rest of the file is still downloading. This approach provides a much better user experience, allowing the audio to start playing within just two to three seconds, rather than waiting for the entire file to download. The seamless transition between the partial playback and the continuation ensures that users hear a continuous, uninterrupted reflection without any awkward gaps or overlapping audio. This is exactly the kind of polished experience that makes an application feel professional and well-designed.';
      addLog(`Test text: "${testText}"`);

      // Fetch audio from API
      setStatus('Fetching audio from API...');
      addLog('Sending request to /api/tts');

      const fetchStartTime = Date.now();
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: testText }),
      });

      const fetchTime = Date.now() - fetchStartTime;
      addLog(`Response received in ${fetchTime}ms`);
      addLog(`Status: ${response.status} ${response.statusText}`);
      addLog(`Content-Type: ${response.headers.get('Content-Type')}`);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `HTTP ${response.status}`);
      }

      // Check content type
      const contentType = response.headers.get('Content-Type') || '';
      addLog(`Received content type: ${contentType}`);

      if (contentType.includes('audio/')) {
        // Binary streaming audio - WAV with progressive playback attempt
        setStatus('Setting up progressive audio playback...');
        addLog('Detected binary audio stream (WAV format)');
        addLog('Attempting progressive WAV playback...');

        const streamStartTime = Date.now();

        // Read stream and collect chunks
        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error('No response body reader available');
        }

        const chunks: Uint8Array[] = [];
        let totalBytes = 0;
        let chunkCount = 0;
        const MIN_BUFFER_FOR_PLAYBACK = 1536 * 1024; // 1.5MB buffer - about 8-9 seconds of audio

        addLog('Reading WAV chunks from stream...');

        // Read chunks and attempt early playback
        let audioContext: AudioContext | null = null;
        let earlyPlaybackStarted = false;
        let firstPlaybackAttempt = false;
        let partialDuration = 0;
        let partialEndedPromise: Promise<void> | null = null;

        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            addLog('All chunks received');
            break;
          }

          if (value) {
            chunks.push(value);
            totalBytes += value.length;
            chunkCount++;

            if (chunkCount <= 5 || chunkCount % 50 === 0) {
              addLog(`Chunk ${chunkCount}: ${value.length} bytes, total: ${(totalBytes / 1024).toFixed(1)}KB`);
            }

            // Attempt early playback once we have enough data
            if (!firstPlaybackAttempt && totalBytes >= MIN_BUFFER_FOR_PLAYBACK) {
              firstPlaybackAttempt = true;
              const bufferTime = Date.now() - streamStartTime;
              addLog(`✅ Buffered ${(totalBytes / 1024).toFixed(1)}KB in ${bufferTime}ms, attempting early playback...`);

              try {
                // Combine what we have so far
                const partialLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
                const partialBuffer = new Uint8Array(partialLength);
                let offset = 0;
                for (const chunk of chunks) {
                  partialBuffer.set(chunk, offset);
                  offset += chunk.length;
                }

                // Create AudioContext
                audioContext = new AudioContext();
                if (audioContext.state === 'suspended') {
                  await audioContext.resume();
                }
                addLog(`AudioContext created (state: ${audioContext.state})`);

                // Try to decode partial WAV
                const audioBuffer = await audioContext.decodeAudioData(partialBuffer.buffer.slice(0));
                partialDuration = audioBuffer.duration;
                addLog(`✅ Partial WAV decoded! Duration: ${partialDuration.toFixed(2)}s`);

                // Play it
                const source = audioContext.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(audioContext.destination);

                const playTime = Date.now() - fetchStartTime;
                addLog(`🎵 PLAYBACK STARTED in ${playTime}ms from initial request`);
                setStatus('Playing audio (partial, will continue with full audio)...');

                // Create promise that resolves when partial playback ends
                partialEndedPromise = new Promise<void>((resolve) => {
                  source.onended = () => {
                    addLog(`Partial playback ended (${partialDuration.toFixed(2)}s played)`);
                    addLog('Ready to continue with remaining audio...');
                    resolve();
                  };
                });

                source.start(0);
                earlyPlaybackStarted = true;

              } catch (error: any) {
                addLog(`⚠️ Early playback failed: ${error.message}`);
                addLog('Will play complete audio when stream finishes...');
              }
            }
          }
        }

        const streamTime = Date.now() - streamStartTime;
        addLog(`Stream complete: ${chunkCount} chunks, ${(totalBytes / 1024).toFixed(1)}KB in ${streamTime}ms`);

        // ALWAYS play complete audio after stream finishes (even if partial played)
        setStatus('Decoding complete audio...');

        // Combine all chunks
        const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
        const completeBuffer = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
          completeBuffer.set(chunk, offset);
          offset += chunk.length;
        }

        addLog(`Combined ${(totalLength / 1024).toFixed(1)}KB WAV data`);

        // Create AudioContext if not already created
        if (!audioContext) {
          audioContext = new AudioContext();
          if (audioContext.state === 'suspended') {
            await audioContext.resume();
          }
          addLog(`AudioContext created (state: ${audioContext.state})`);
        }

        // Decode complete WAV
        const decodeStart = Date.now();
        const completeAudioBuffer = await audioContext.decodeAudioData(completeBuffer.buffer.slice(0));
        const decodeTime = Date.now() - decodeStart;

        addLog(`Complete audio decoded in ${decodeTime}ms`);
        addLog(`Duration: ${completeAudioBuffer.duration.toFixed(2)}s`);
        addLog(`Sample rate: ${completeAudioBuffer.sampleRate}Hz`);
        addLog(`Channels: ${completeAudioBuffer.numberOfChannels}`);

        // Play complete audio from where partial left off
        const source = audioContext.createBufferSource();
        source.buffer = completeAudioBuffer;
        source.connect(audioContext.destination);

        source.onended = () => {
          const totalTime = Date.now() - fetchStartTime;
          addLog(`Playback ended. Total time: ${totalTime}ms`);
          setStatus('Test completed successfully! ✅');
          setIsPlaying(false);
        };

        if (earlyPlaybackStarted) {
          // Wait for partial playback to finish before starting continuation
          if (partialEndedPromise) {
            addLog('Waiting for partial playback to finish...');
            await partialEndedPromise;
            addLog('Partial playback finished, starting continuation...');
          }

          // Start from where partial playback ended
          const skipTo = partialDuration;
          addLog(`▶️ Playing remaining audio from ${skipTo.toFixed(2)}s...`);
          setStatus('Playing remaining audio...');
          source.start(0, skipTo);
        } else {
          // Play from beginning
          const playTime = Date.now() - fetchStartTime;
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
        <p style={{ margin: 0, fontWeight: 'bold' }}>Test Text (Long):</p>
        <div style={{ margin: '0.5rem 0', fontStyle: 'italic', fontSize: '0.85rem', maxHeight: '120px', overflowY: 'auto', padding: '0.5rem', background: '#fff', borderRadius: '4px' }}>
          "Hello! This is a comprehensive test of the audio streaming system. We are testing how quickly Cartesia can generate speech and stream it back to the client. The goal is to measure the time it takes from making the request to hearing the first audio, as well as the total time to complete playback. This longer sentence will help us understand the performance characteristics of the streaming implementation. Progressive audio playback is a critical feature for creating responsive user experiences. When users write journal entries and request AI reflections, they should not have to wait several seconds before hearing the response. By using WAV format instead of MP3, we can decode and play partial audio while the rest of the file is still downloading. This approach provides a much better user experience, allowing the audio to start playing within just two to three seconds, rather than waiting for the entire file to download. The seamless transition between the partial playback and the continuation ensures that users hear a continuous, uninterrupted reflection without any awkward gaps or overlapping audio. This is exactly the kind of polished experience that makes an application feel professional and well-designed."
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
          <li><strong>WAV/PCM streaming from Cartesia (NEW!)</strong></li>
          <li>Progressive playback with Web Audio API</li>
          <li>Early playback after buffering 1.5MB (~8-9 seconds)</li>
          <li>Time to first audio (target: 2-3s)</li>
          <li>Minimal or no gap before continuation</li>
        </ul>
        <p style={{ marginTop: '1rem', fontSize: '0.9rem', color: '#666' }}>
          <strong>WAV Progressive Playback:</strong> Buffers 1.5MB (~8-9 seconds of audio) before starting playback. Since the full 4MB file streams in ~6 seconds, the partial playback will cover most of the download time, resulting in minimal or no gap.
        </p>
        <p style={{ marginTop: '0.5rem', fontSize: '0.9rem', color: '#666' }}>
          <strong>Performance:</strong> Starts playing in 2-3 seconds, then plays continuously through to the end with seamless transition when the full audio takes over.
        </p>
      </div>
    </div>
  );
}
