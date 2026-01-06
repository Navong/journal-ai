'use client';

import { useState, useRef, useEffect } from 'react';
import { AudioStreamPlayer, AudioFormat } from '@/app/utils/audioStreamPlayer';

export default function TestAudioPage() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [status, setStatus] = useState('Ready to test');
  const [logs, setLogs] = useState<string[]>([]);
  const [provider, setProvider] = useState<'cartesia' | 'murf' | 'elevenlabs' | 'fish' | 'gemini'>('cartesia');
  const [textLength, setTextLength] = useState<'short' | 'long' | 'journal'>('short');
  const [mood, setMood] = useState<'calm' | 'joyful' | 'anxious' | 'tired' | 'reflective' | 'heavy' | 'none'>('none');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const audioPlayerRef = useRef<AudioStreamPlayer | null>(null);

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

      // Test texts (computed dynamically based on provider)
      const providerName = provider === 'cartesia' ? 'Cartesia' : provider === 'murf' ? 'Murf' : provider === 'elevenlabs' ? 'ElevenLabs' : provider === 'fish' ? 'Fish Audio' : 'Gemini Flash';
      const shortText = `Hello! This is a comprehensive test of the audio streaming system. We are testing how quickly ${providerName} can generate speech and stream it back to the client.`;

      const longText = `Hello! This is a comprehensive test of the audio streaming system. We are testing how quickly ${providerName} can generate speech and stream it back to the client. The goal is to measure the time it takes from making the request to hearing the first audio, as well as the total time to complete playback. This longer sentence will help us understand the performance characteristics of the streaming implementation. Progressive audio playback is a critical feature for creating responsive user experiences. When users write journal entries and request AI reflections, they should not have to wait several seconds before hearing the response. By using WAV format instead of MP3, we can decode and play partial audio while the rest of the file is still downloading. This approach provides a much better user experience, allowing the audio to start playing within just two to three seconds, rather than waiting for the entire file to download. The seamless transition between the partial playback and the continuation ensures that users hear a continuous, uninterrupted reflection without any awkward gaps or overlapping audio. This is exactly the kind of polished experience that makes an application feel professional and well-designed.`;

      const journalText = `Today was challenging. I spent most of the morning in back-to-back meetings about the new project launch. 오늘 정말 바쁜 하루였어요. The deadline is approaching fast, and I can feel the pressure building. My manager Sarah mentioned that we need to finalize the marketing strategy by next week.

점심시간에 잠깐 공원을 산책했는데, 그게 큰 도움이 됐어요. The fresh air helped clear my mind. I realized that I've been so focused on work that I haven't called my parents in two weeks. 부모님께 전화드려야 하는데 자꾸 미루게 되네요.

Sometimes I wonder if I'm doing enough. The team at the office seems to be handling everything so well, but I feel like I'm always playing catch-up. 내일은 좀 더 여유있게 시작해봐야겠어요.`;

      const testText = textLength === 'short' ? shortText : textLength === 'long' ? longText : journalText;
      addLog(`Test text length: ${textLength} (${testText.length} characters)`);
      addLog(`Test text: "${testText.substring(0, 100)}${testText.length > 100 ? '...' : ''}"`);

      // Fetch audio from API
      setStatus('Fetching audio from API...');
      addLog('Sending request to /api/tts');

      const requestStartTime = Date.now();
      addLog(`Using TTS provider: ${provider}`);
      if (mood !== 'none') {
        addLog(`Selected mood: ${mood} (Fish Audio will apply emotion)`);
      }
      addLog(`📤 Sending request to /api/tts at ${new Date().toLocaleTimeString()}`);

      const fetchStartTime = Date.now();
      // Determine format based on provider
      // Cartesia and Murf use raw PCM (needs manual conversion)
      // Fish and Gemini use WAV (PCM with headers, browser-decodable)
      // ElevenLabs uses MP3 (compressed, smaller size)
      const formatParam: AudioFormat = (provider === 'cartesia' || provider === 'murf') ? 'pcm' : (provider === 'fish' || provider === 'gemini' ? 'wav' : 'mp3');
      addLog('🔄 S3 cache DISABLED (skipCache=true) - testing real API stream');
      const response = await fetch(`/api/tts?provider=${provider}&format=${formatParam}&skipCache=true`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: testText, mood: mood !== 'none' ? mood : undefined }),
      });

      const fetchTime = Date.now() - fetchStartTime;
      const totalTimeToResponse = Date.now() - requestStartTime;
      addLog(`⏱️ Response received: ${fetchTime}ms (total: ${totalTimeToResponse}ms from request start)`);
      addLog(`Status: ${response.status} ${response.statusText}`);
      addLog(`Content-Type: ${response.headers.get('Content-Type')}`);

      // Log cache status from response headers
      const cacheStatus = response.headers.get('X-Cache-Status');
      if (cacheStatus) {
        addLog(`📦 Cache Status: ${cacheStatus}`);
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `HTTP ${response.status}`);
      }

      // Check content type
      const contentType = response.headers.get('Content-Type') || '';
      const sampleRateHeader = response.headers.get('X-Audio-Sample-Rate');
      const sampleRate = sampleRateHeader ? parseInt(sampleRateHeader, 10) : 44100;
      addLog(`Received content type: ${contentType} (${formatParam} format, ${sampleRate}Hz)`);

      if (contentType.includes('audio/')) {
        // Binary streaming audio - use AudioStreamPlayer
        setStatus(`Setting up ${formatParam.toUpperCase()} audio playback...`);
        addLog(`Detected binary audio stream (${formatParam.toUpperCase()} format)`);
        if (formatParam === 'pcm') {
          addLog('PCM format: Lowest latency, uncompressed, largest payload size');
        }

        // Use AudioStreamPlayer for unified streaming playback
        audioPlayerRef.current = new AudioStreamPlayer({
          format: formatParam,
          sampleRate,
          onLog: addLog,
          onProgress: (bytesReceived) => {
            // Progress updates are logged by AudioStreamPlayer
          },
          onStatusChange: setStatus,
        });

        await audioPlayerRef.current.playFromResponse(response);
        setIsPlaying(false);

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
    if (audioPlayerRef.current) {
      audioPlayerRef.current.stop();
    }
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
      if (audioPlayerRef.current) {
        audioPlayerRef.current.dispose();
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
              onChange={(e) => setProvider(e.target.value as 'cartesia' | 'murf' | 'elevenlabs' | 'fish' | 'gemini')}
              disabled={isPlaying}
              style={{ marginRight: '0.5rem' }}
            />
            Fish Audio (S1)
          </label>
          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
            <input
              type="radio"
              value="gemini"
              checked={provider === 'gemini'}
              onChange={(e) => setProvider(e.target.value as 'cartesia' | 'murf' | 'elevenlabs' | 'fish' | 'gemini')}
              disabled={isPlaying}
              style={{ marginRight: '0.5rem' }}
            />
            Gemini Flash
          </label>
        </div>
        <p style={{ margin: 0, fontWeight: 'bold', marginBottom: '0.5rem' }}>Text Length:</p>
        <div style={{ marginBottom: '1rem', display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
            <input
              type="radio"
              value="short"
              checked={textLength === 'short'}
              onChange={(e) => setTextLength(e.target.value as 'short' | 'long' | 'journal')}
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
              onChange={(e) => setTextLength(e.target.value as 'short' | 'long' | 'journal')}
              disabled={isPlaying}
              style={{ marginRight: '0.5rem' }}
            />
            Long
          </label>
          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
            <input
              type="radio"
              value="journal"
              checked={textLength === 'journal'}
              onChange={(e) => setTextLength(e.target.value as 'short' | 'long' | 'journal')}
              disabled={isPlaying}
              style={{ marginRight: '0.5rem' }}
            />
            Journal (EN+KO)
          </label>
        </div>
        <p style={{ margin: 0, fontWeight: 'bold', marginBottom: '0.5rem', marginTop: '1rem' }}>Mood (Fish Audio Emotion):</p>
        <div style={{ marginBottom: '1rem', display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
            <input
              type="radio"
              value="none"
              checked={mood === 'none'}
              onChange={(e) => setMood(e.target.value as any)}
              disabled={isPlaying}
              style={{ marginRight: '0.5rem' }}
            />
            None
          </label>
          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
            <input
              type="radio"
              value="calm"
              checked={mood === 'calm'}
              onChange={(e) => setMood(e.target.value as any)}
              disabled={isPlaying}
              style={{ marginRight: '0.5rem' }}
            />
            Calm
          </label>
          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
            <input
              type="radio"
              value="joyful"
              checked={mood === 'joyful'}
              onChange={(e) => setMood(e.target.value as any)}
              disabled={isPlaying}
              style={{ marginRight: '0.5rem' }}
            />
            Joyful
          </label>
          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
            <input
              type="radio"
              value="anxious"
              checked={mood === 'anxious'}
              onChange={(e) => setMood(e.target.value as any)}
              disabled={isPlaying}
              style={{ marginRight: '0.5rem' }}
            />
            Anxious
          </label>
          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
            <input
              type="radio"
              value="tired"
              checked={mood === 'tired'}
              onChange={(e) => setMood(e.target.value as any)}
              disabled={isPlaying}
              style={{ marginRight: '0.5rem' }}
            />
            Tired
          </label>
          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
            <input
              type="radio"
              value="reflective"
              checked={mood === 'reflective'}
              onChange={(e) => setMood(e.target.value as any)}
              disabled={isPlaying}
              style={{ marginRight: '0.5rem' }}
            />
            Reflective
          </label>
          <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
            <input
              type="radio"
              value="heavy"
              checked={mood === 'heavy'}
              onChange={(e) => setMood(e.target.value as any)}
              disabled={isPlaying}
              style={{ marginRight: '0.5rem' }}
            />
            Heavy
          </label>
        </div>
        <p style={{ margin: 0, fontWeight: 'bold' }}>Test Text:</p>
        <div style={{ margin: '0.5rem 0', fontStyle: 'italic', fontSize: '0.85rem', maxHeight: '120px', overflowY: 'auto', padding: '0.5rem', background: '#fff', borderRadius: '4px' }}>
          {(() => {
            const providerName = provider === 'cartesia' ? 'Cartesia' : provider === 'murf' ? 'Murf' : provider === 'elevenlabs' ? 'ElevenLabs' : provider === 'fish' ? 'Fish Audio' : 'Gemini Flash';
            const short = `Hello! This is a comprehensive test of the audio streaming system. We are testing how quickly ${providerName} can generate speech and stream it back to the client.`;
            const long = `Hello! This is a comprehensive test of the audio streaming system. We are testing how quickly ${providerName} can generate speech and stream it back to the client. The goal is to measure the time it takes from making the request to hearing the first audio, as well as the total time to complete playback. This longer sentence will help us understand the performance characteristics of the streaming implementation. Progressive audio playback is a critical feature for creating responsive user experiences. When users write journal entries and request AI reflections, they should not have to wait several seconds before hearing the response. By using WAV format instead of MP3, we can decode and play partial audio while the rest of the file is still downloading. This approach provides a much better user experience, allowing the audio to start playing within just two to three seconds, rather than waiting for the entire file to download. The seamless transition between the partial playback and the continuation ensures that users hear a continuous, uninterrupted reflection without any awkward gaps or overlapping audio. This is exactly the kind of polished experience that makes an application feel professional and well-designed.`;
            const journal = `Today was challenging. I spent most of the morning in back-to-back meetings about the new project launch. 오늘 정말 바쁜 하루였어요. The deadline is approaching fast, and I can feel the pressure building. My manager Sarah mentioned that we need to finalize the marketing strategy by next week.

점심시간에 잠깐 공원을 산책했는데, 그게 큰 도움이 됐어요. The fresh air helped clear my mind. I realized that I've been so focused on work that I haven't called my parents in two weeks. 부모님께 전화드려야 하는데 자꾸 미루게 되네요.

Sometimes I wonder if I'm doing enough. The team at the office seems to be handling everything so well, but I feel like I'm always playing catch-up. 내일은 좀 더 여유있게 시작해봐야겠어요.`;
            return `"${textLength === 'short' ? short : textLength === 'long' ? long : journal}"`;
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
          <li><strong>PCM/WAV/MP3 streaming from Cartesia, Murf.ai, ElevenLabs, Fish Audio, or Gemini Flash</strong></li>
          <li>Progressive playback with Web Audio API</li>
          <li>Early playback after buffering 512KB (optimized for faster start)</li>
          <li>Time to first audio (target: 1-2s)</li>
          <li>Minimal or no gap before continuation</li>
        </ul>
        <p style={{ marginTop: '1rem', fontSize: '0.9rem', color: '#666' }}>
          <strong>Providers:</strong> Select between Cartesia, Murf.ai, ElevenLabs, Fish Audio, or Gemini Flash to compare performance and quality.
          <br />• <strong>Cartesia:</strong> Raw PCM streaming - chunks arrive progressively, lowest latency (~1-2s to first audio)
          <br />• <strong>Murf.ai (Gen2):</strong> Raw PCM streaming - Studio-quality speech synthesis with Miles voice (Calm style)
          <br />• <strong>ElevenLabs:</strong> MP3 streaming - High-quality TTS with ultra-low latency models
          <br />• <strong>Fish Audio (S1):</strong> WAV streaming - Latest model with emotion control and voice cloning - balanced latency mode (~300ms)
          <br />• <strong>Gemini Flash:</strong> WAV streaming - Google's cost-effective TTS with 30+ voices (Kore voice) - balanced quality and speed
        </p>
        <p style={{ marginTop: '0.5rem', fontSize: '0.9rem', color: '#666' }}>
          <strong>Progressive Playback:</strong> Buffers 512KB (~1-2 seconds of audio) before starting playback. ElevenLabs chunks are automatically split into 64KB sub-chunks for smoother streaming.
        </p>
        <p style={{ marginTop: '0.5rem', fontSize: '0.9rem', color: '#666' }}>
          <strong>Performance:</strong> Starts playing in 1-2 seconds, then plays continuously through to the end with seamless transition when the full audio takes over.
        </p>
      </div>
    </div>
  );
}
