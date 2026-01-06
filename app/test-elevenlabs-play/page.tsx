'use client';

import { useState, useRef, useEffect } from 'react';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';

// Note: The 'play' function from @elevenlabs/elevenlabs-js is designed for Node.js
// and requires mpv/ffmpeg. It won't work directly in the browser.
// This test page demonstrates how to adapt it for browser use.

type TTSProvider = 'elevenlabs' | 'cartesia' | 'murf' | 'fish';

export default function TestElevenLabsPlayPage() {
    const [isPlaying, setIsPlaying] = useState(false);
    const [status, setStatus] = useState('Ready to test');
    const [logs, setLogs] = useState<string[]>([]);
    const [testMethod, setTestMethod] = useState<'sdk-direct' | 'sdk-stream' | 'api-stream' | 'api-stream-webaudio'>('api-stream-webaudio');
    const [ttsProvider, setTtsProvider] = useState<TTSProvider>('elevenlabs');
    const audioContextRef = useRef<AudioContext | null>(null);

    const addLog = (message: string) => {
        const timestamp = new Date().toLocaleTimeString();
        const logMessage = `[${timestamp}] ${message}`;
        console.log(logMessage);
        setLogs(prev => [...prev, logMessage]);
    };

    // Auto-switch to API method when non-ElevenLabs provider is selected
    useEffect(() => {
        if (ttsProvider !== 'elevenlabs' && (testMethod === 'sdk-direct' || testMethod === 'sdk-stream')) {
            setTestMethod('api-stream-webaudio');
        }
    }, [ttsProvider, testMethod]);

    // Convert raw PCM bytes to AudioBuffer for Web Audio API
    const pcmToAudioBuffer = (pcmData: Uint8Array, audioContext: AudioContext, channels: number = 1): AudioBuffer => {
        const numSamples = Math.floor(pcmData.length / 2);
        const audioBuffer = audioContext.createBuffer(channels, numSamples, audioContext.sampleRate);
        const dataView = new DataView(pcmData.buffer, pcmData.byteOffset, pcmData.byteLength);
        const channelData = audioBuffer.getChannelData(0);

        for (let i = 0; i < numSamples; i++) {
            const int16Value = dataView.getInt16(i * 2, true);
            channelData[i] = int16Value / 32768.0;
        }

        return audioBuffer;
    };

    // Test 1: Direct SDK usage (textToSpeech.convert) - this returns a ReadableStream
    const testSDKDirect = async () => {
        try {
            setIsPlaying(true);
            setStatus('Testing SDK direct method...');
            addLog('=== Test 1: SDK Direct (textToSpeech.convert) ===');

            const apiKey = process.env.NEXT_PUBLIC_ELEVENLABS_API_KEY || '';
            if (!apiKey) {
                throw new Error('NEXT_PUBLIC_ELEVENLABS_API_KEY not set. This test requires API key in client-side env var.');
            }

            const client = new ElevenLabsClient({ apiKey });
            const voiceId = '21m00Tcm4TlvDq8ikWAM'; // Rachel
            const testText = 'Hello! This is a test of ElevenLabs SDK streaming capabilities.';

            addLog(`Using voice: ${voiceId}`);
            addLog(`Text: ${testText}`);

            const startTime = Date.now();

            // Use convert instead of streamWithTimestamps - this returns a ReadableStream directly
            const audioStream = await client.textToSpeech.convert(voiceId, {
                text: testText,
                modelId: 'eleven_multilingual_v2',
                outputFormat: 'mp3_44100_128',
            });

            const fetchTime = Date.now() - startTime;
            addLog(`✅ SDK stream obtained in ${fetchTime}ms`);

            // Read the stream and play using Web Audio API
            const reader = audioStream.getReader();
            const chunks: Uint8Array[] = [];

            addLog('📥 Reading audio chunks from stream...');
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
                addLog(`📦 Chunk ${chunks.length}: ${value.length} bytes`);
            }

            const totalBytes = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
            addLog(`✅ All chunks received: ${chunks.length} chunks, ${(totalBytes / 1024).toFixed(1)}KB`);

            // Combine chunks
            const audioData = new Uint8Array(totalBytes);
            let offset = 0;
            for (const chunk of chunks) {
                audioData.set(chunk, offset);
                offset += chunk.length;
            }

            // Create AudioContext and decode MP3
            const audioContext = new AudioContext();
            audioContextRef.current = audioContext;
            const audioBuffer = await audioContext.decodeAudioData(audioData.buffer.slice(0));

            addLog(`🔊 Audio decoded: ${audioBuffer.duration.toFixed(2)}s, ${audioBuffer.sampleRate}Hz`);

            // Play using Web Audio API
            const source = audioContext.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(audioContext.destination);

            source.onended = () => {
                addLog('✅ Playback completed');
                setIsPlaying(false);
                setStatus('Test completed successfully! ✅');
            };

            addLog('🎵 Starting playback...');
            setStatus('Playing audio...');
            source.start(0);

        } catch (error: any) {
            addLog(`❌ Error: ${error.message}`);
            setStatus(`Error: ${error.message}`);
            setIsPlaying(false);
        }
    };

    // Test 2: SDK streaming (streamWithTimestamps) - similar to our current implementation
    const testSDKStream = async () => {
        try {
            setIsPlaying(true);
            setStatus('Testing SDK streaming method...');
            addLog('=== Test 2: SDK Streaming (streamWithTimestamps) ===');

            const apiKey = process.env.NEXT_PUBLIC_ELEVENLABS_API_KEY || '';
            if (!apiKey) {
                throw new Error('NEXT_PUBLIC_ELEVENLABS_API_KEY not set');
            }

            const client = new ElevenLabsClient({ apiKey });
            const voiceId = '21m00Tcm4TlvDq8ikWAM';
            const testText = 'Hello! This is a test of ElevenLabs SDK streaming with timestamps.';

            addLog(`Using voice: ${voiceId}`);
            addLog(`Text: ${testText}`);

            const startTime = Date.now();
            const streamResponse = await client.textToSpeech.streamWithTimestamps(voiceId, {
                text: testText,
                modelId: 'eleven_multilingual_v2',
                outputFormat: 'mp3_44100_128',
            });

            const fetchTime = Date.now() - startTime;
            addLog(`✅ SDK stream obtained in ${fetchTime}ms`);

            // Read the async iterable
            const chunks: Uint8Array[] = [];
            let chunkCount = 0;

            addLog('📥 Reading audio chunks from stream...');
            for await (const chunk of streamResponse) {
                if (chunk.audioBase64) {
                    // Decode base64
                    const binaryString = atob(chunk.audioBase64);
                    const audioBytes = new Uint8Array(binaryString.length);
                    for (let i = 0; i < binaryString.length; i++) {
                        audioBytes[i] = binaryString.charCodeAt(i);
                    }
                    chunks.push(audioBytes);
                    chunkCount++;
                    addLog(`📦 Chunk ${chunkCount}: ${audioBytes.length} bytes`);
                }
            }

            const totalBytes = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
            addLog(`✅ All chunks received: ${chunkCount} chunks, ${(totalBytes / 1024).toFixed(1)}KB`);

            // Combine and play
            const audioData = new Uint8Array(totalBytes);
            let offset = 0;
            for (const chunk of chunks) {
                audioData.set(chunk, offset);
                offset += chunk.length;
            }

            const audioContext = new AudioContext();
            audioContextRef.current = audioContext;
            const audioBuffer = await audioContext.decodeAudioData(audioData.buffer.slice(0));

            addLog(`🔊 Audio decoded: ${audioBuffer.duration.toFixed(2)}s`);

            const source = audioContext.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(audioContext.destination);

            source.onended = () => {
                addLog('✅ Playback completed');
                setIsPlaying(false);
                setStatus('Test completed successfully! ✅');
            };

            addLog('🎵 Starting playback...');
            setStatus('Playing audio...');
            source.start(0);

        } catch (error: any) {
            addLog(`❌ Error: ${error.message}`);
            setStatus(`Error: ${error.message}`);
            setIsPlaying(false);
        }
    };

    // Test 3: Our API route streaming (like our current implementation)
    const testAPIStream = async () => {
        try {
            setIsPlaying(true);
            setStatus('Testing API route streaming...');
            addLog('=== Test 3: API Route Streaming (Our Current Implementation) ===');

            const testText = 'Hello! This is a test of our API route streaming implementation.';

            addLog(`Provider: ${ttsProvider}`);
            addLog(`Text: ${testText}`);

            const startTime = Date.now();
            const response = await fetch(`/api/tts?provider=${ttsProvider}&format=mp3`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: testText }),
            });

            if (!response.ok) {
                throw new Error(`API error: ${response.status} ${response.statusText}`);
            }

            const fetchTime = Date.now() - startTime;
            addLog(`✅ API response received in ${fetchTime}ms`);

            const reader = response.body?.getReader();
            if (!reader) {
                throw new Error('No response body reader');
            }

            const chunks: Uint8Array[] = [];
            let chunkCount = 0;

            addLog('📥 Reading audio chunks from API stream...');
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
                chunkCount++;
                if (chunkCount <= 5 || chunkCount % 50 === 0) {
                    addLog(`📦 Chunk ${chunkCount}: ${value.length} bytes`);
                }
            }

            const totalBytes = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
            addLog(`✅ All chunks received: ${chunkCount} chunks, ${(totalBytes / 1024).toFixed(1)}KB`);

            // Combine and play using HTML5 audio (simpler for MP3)
            const audioData = new Uint8Array(totalBytes);
            let offset = 0;
            for (const chunk of chunks) {
                audioData.set(chunk, offset);
                offset += chunk.length;
            }

            const blob = new Blob([audioData], { type: 'audio/mpeg' });
            const url = URL.createObjectURL(blob);

            const audio = new Audio(url);
            audio.onended = () => {
                addLog('✅ Playback completed');
                URL.revokeObjectURL(url);
                setIsPlaying(false);
                setStatus('Test completed successfully! ✅');
            };

            audio.onerror = (e) => {
                addLog(`❌ Audio error: ${e}`);
                setIsPlaying(false);
            };

            addLog('🎵 Starting playback...');
            setStatus('Playing audio...');
            await audio.play();

        } catch (error: any) {
            addLog(`❌ Error: ${error.message}`);
            setStatus(`Error: ${error.message}`);
            setIsPlaying(false);
        }
    };

    // Test 4: API route streaming with Web Audio API (like our test-audio page)
    const testAPIStreamWebAudio = async () => {
        try {
            setIsPlaying(true);
            setStatus('Testing API route streaming with Web Audio API...');
            addLog('=== Test 4: API Route Streaming with Web Audio API ===');

            const testText = 'Hello! This is a test of API streaming with Web Audio API for progressive playback.';

            addLog(`Provider: ${ttsProvider}`);
            addLog(`Text: ${testText}`);

            const startTime = Date.now();
            const response = await fetch(`/api/tts?provider=${ttsProvider}&format=mp3`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: testText }),
            });

            if (!response.ok) {
                throw new Error(`API error: ${response.status}`);
            }

            const fetchTime = Date.now() - startTime;
            addLog(`✅ API response received in ${fetchTime}ms`);

            const reader = response.body?.getReader();
            if (!reader) {
                throw new Error('No response body reader');
            }

            const chunks: Uint8Array[] = [];
            let chunkCount = 0;
            const streamStartTime = Date.now();

            addLog('📥 Reading audio chunks from API stream...');
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
                chunkCount++;
                if (chunkCount <= 5 || chunkCount % 50 === 0) {
                    const elapsed = Date.now() - streamStartTime;
                    const totalBytes = chunks.reduce((sum, c) => sum + c.length, 0);
                    const rate = (totalBytes / 1024) / (elapsed / 1000);
                    addLog(`📦 Chunk ${chunkCount}: ${value.length} bytes, total: ${(totalBytes / 1024).toFixed(1)}KB, rate: ${rate.toFixed(2)}KB/s`);
                }
            }

            const totalBytes = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
            const streamTime = Date.now() - streamStartTime;
            addLog(`✅ All chunks received: ${chunkCount} chunks, ${(totalBytes / 1024).toFixed(1)}KB in ${streamTime}ms`);

            // Combine and decode with Web Audio API
            const audioData = new Uint8Array(totalBytes);
            let offset = 0;
            for (const chunk of chunks) {
                audioData.set(chunk, offset);
                offset += chunk.length;
            }

            const audioContext = new AudioContext();
            audioContextRef.current = audioContext;

            const decodeStart = Date.now();
            const audioBuffer = await audioContext.decodeAudioData(audioData.buffer.slice(0));
            const decodeTime = Date.now() - decodeStart;

            addLog(`🔊 Audio decoded in ${decodeTime}ms: ${audioBuffer.duration.toFixed(2)}s, ${audioBuffer.sampleRate}Hz`);

            const source = audioContext.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(audioContext.destination);

            source.onended = () => {
                const totalTime = Date.now() - startTime;
                addLog('✅ Playback completed');
                addLog(`📊 Total time: ${totalTime}ms from request start`);
                setIsPlaying(false);
                setStatus('Test completed successfully! ✅');
            };

            addLog('🎵 Starting playback...');
            setStatus('Playing audio...');
            source.start(0);

        } catch (error: any) {
            addLog(`❌ Error: ${error.message}`);
            setStatus(`Error: ${error.message}`);
            setIsPlaying(false);
        }
    };

    const runTest = async () => {
        setLogs([]);

        switch (testMethod) {
            case 'sdk-direct':
                await testSDKDirect();
                break;
            case 'sdk-stream':
                await testSDKStream();
                break;
            case 'api-stream':
                await testAPIStream();
                break;
            case 'api-stream-webaudio':
                await testAPIStreamWebAudio();
                break;
        }
    };

    const clearLogs = () => {
        setLogs([]);
    };

    return (
        <div className="container mx-auto p-6 max-w-4xl">
            <h1 className="text-3xl font-bold mb-6">TTS Provider Test Page</h1>

            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
                <p className="text-sm text-yellow-800">
                    <strong>Note:</strong> This test page allows you to compare different TTS providers (ElevenLabs, Cartesia, Murf, Fish Audio)
                    and test different streaming approaches. Select a provider and test method, then run the test to see how it performs.
                    SDK methods only work with ElevenLabs.
                </p>
            </div>

            <div className="bg-white rounded-lg shadow-md p-6 mb-6">
                <h2 className="text-xl font-semibold mb-4">Test Configuration</h2>

                <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                        TTS Provider:
                    </label>
                    <select
                        value={ttsProvider}
                        onChange={(e) => setTtsProvider(e.target.value as TTSProvider)}
                        disabled={isPlaying}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                        <option value="elevenlabs">ElevenLabs</option>
                        <option value="cartesia">Cartesia</option>
                        <option value="murf">Murf</option>
                        <option value="fish">Fish Audio</option>
                    </select>
                </div>

                <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                        Test Method:
                    </label>
                    <select
                        value={testMethod}
                        onChange={(e) => setTestMethod(e.target.value as any)}
                        disabled={isPlaying}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                        <option value="sdk-direct" disabled={ttsProvider !== 'elevenlabs'}>
                            SDK Direct (textToSpeech.convert) {ttsProvider !== 'elevenlabs' ? '- ElevenLabs only' : ''}
                        </option>
                        <option value="sdk-stream" disabled={ttsProvider !== 'elevenlabs'}>
                            SDK Streaming (streamWithTimestamps) {ttsProvider !== 'elevenlabs' ? '- ElevenLabs only' : ''}
                        </option>
                        <option value="api-stream">API Route Streaming (HTML5 Audio)</option>
                        <option value="api-stream-webaudio">API Route Streaming (Web Audio API)</option>
                    </select>
                </div>

                <div className="flex gap-4">
                    <button
                        onClick={runTest}
                        disabled={isPlaying}
                        className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                    >
                        {isPlaying ? 'Running Test...' : 'Run Test'}
                    </button>

                    <button
                        onClick={clearLogs}
                        disabled={isPlaying}
                        className="px-6 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 disabled:bg-gray-100 disabled:cursor-not-allowed"
                    >
                        Clear Logs
                    </button>
                </div>

                <div className="mt-4">
                    <p className="text-sm text-gray-600">Status: <span className="font-semibold">{status}</span></p>
                </div>
            </div>

            <div className="bg-white rounded-lg shadow-md p-6">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-semibold">Test Logs</h2>
                    <span className="text-sm text-gray-500">{logs.length} entries</span>
                </div>

                <div className="bg-gray-50 rounded-lg p-4 max-h-96 overflow-y-auto font-mono text-sm">
                    {logs.length === 0 ? (
                        <p className="text-gray-400">No logs yet. Run a test to see output.</p>
                    ) : (
                        logs.map((log, index) => (
                            <div key={index} className="mb-1 text-gray-800">
                                {log}
                            </div>
                        ))
                    )}
                </div>
            </div>

            <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h3 className="font-semibold text-blue-900 mb-2">Test Methods Explained:</h3>
                <ul className="text-sm text-blue-800 space-y-1 list-disc list-inside">
                    <li><strong>SDK Direct (ElevenLabs only):</strong> Uses <code>textToSpeech.convert()</code> - returns a ReadableStream directly</li>
                    <li><strong>SDK Streaming (ElevenLabs only):</strong> Uses <code>streamWithTimestamps()</code> - returns async iterable</li>
                    <li><strong>API Route (HTML5):</strong> Our API route + HTML5 Audio element (simpler for MP3, works with all providers)</li>
                    <li><strong>API Route (Web Audio):</strong> Our API route + Web Audio API (more control, progressive playback, works with all providers)</li>
                </ul>

                <h3 className="font-semibold text-blue-900 mt-4 mb-2">TTS Providers:</h3>
                <ul className="text-sm text-blue-800 space-y-1 list-disc list-inside">
                    <li><strong>ElevenLabs:</strong> High quality, multiple voices, SDK + API support</li>
                    <li><strong>Cartesia:</strong> Low latency, WebSocket streaming (default provider)</li>
                    <li><strong>Murf:</strong> Natural voices, API-based</li>
                    <li><strong>Fish Audio:</strong> Open-source alternative</li>
                </ul>
            </div>
        </div>
    );
}

