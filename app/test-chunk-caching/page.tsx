'use client';

import { useState, useEffect } from 'react';
import { processTextIntoChunks, ChunkMetadata } from '@/app/utils/chunkCaching';

interface TestLog {
    time: string;
    message: string;
    type: 'info' | 'success' | 'error' | 'warning';
}

interface ChunkWithStatus extends ChunkMetadata {
    cacheStatus?: 'hit' | 'miss' | 'pending';
    isExpanded?: boolean;
}

interface Statistics {
    totalChunks: number;
    cacheHits: number;
    cacheMisses: number;
    hitRate: number;
    estimatedTTSSaved: number;
    estimatedTimeSaved: number; // in seconds
}

const TEST_SCENARIOS = {
    repeated: `I feel calm today. I feel calm today. I feel calm today. The weather is nice. The weather is nice.`,
    unique: `This is a completely unique journal entry. It has never been written before. Every sentence is different.`,
    mixed: `I feel calm today. This is a new thought about my day. I feel calm today. The weather is nice. Here's another unique sentence.`,
    long: `This is a very long sentence that might exceed the character limit for a single chunk and should be handled appropriately by the chunking system. It contains multiple clauses and ideas that flow together.`,
};

export default function TestChunkCachingPage() {
    const [text, setText] = useState('I feel calm today. The weather is nice. I feel calm today.');
    const [chunks, setChunks] = useState<ChunkWithStatus[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [isCheckingCache, setIsCheckingCache] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    const [logs, setLogs] = useState<TestLog[]>([]);
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const [statistics, setStatistics] = useState<Statistics | null>(null);
    const [s3Status, setS3Status] = useState<{
        configured?: boolean;
        connected?: boolean;
        bucket?: string;
        region?: string;
        message?: string;
        error?: string;
        missing?: string[];
    } | null>(null);
    const [isTestingS3, setIsTestingS3] = useState(false);

    const addLog = (message: string, type: TestLog['type'] = 'info') => {
        const time = new Date().toLocaleTimeString();
        setLogs(prev => [...prev, { time, message, type }]);
        console.log(`[${time}] [${type.toUpperCase()}] ${message}`);
    };

    const clearLogs = () => {
        setLogs([]);
    };

    // Process text into chunks
    const processText = async () => {
        if (!text.trim()) {
            addLog('Please enter some text to process', 'warning');
            return;
        }

        setIsProcessing(true);
        addLog('Processing text into chunks...', 'info');

        try {
            const processedChunks = await processTextIntoChunks(text);
            const chunksWithStatus: ChunkWithStatus[] = processedChunks.map(chunk => ({
                ...chunk,
                cacheStatus: undefined,
                isExpanded: false,
            }));

            setChunks(chunksWithStatus);
            addLog(`✅ Processed ${processedChunks.length} chunks`, 'success');

            // Check for invalid chunks
            const invalidChunks = processedChunks.filter(c => !c.isValidLength);
            if (invalidChunks.length > 0) {
                addLog(`⚠️ Warning: ${invalidChunks.length} chunks exceed 200 character limit`, 'warning');
            }

            // Update statistics
            updateStatistics(chunksWithStatus);
        } catch (error: any) {
            addLog(`❌ Error processing text: ${error.message}`, 'error');
            console.error('Error processing text:', error);
        } finally {
            setIsProcessing(false);
        }
    };

    // Check cache status for all chunks
    const checkCacheStatus = async () => {
        if (chunks.length === 0) {
            addLog('Please process text into chunks first', 'warning');
            return;
        }

        setIsCheckingCache(true);
        addLog('Checking cache status for all chunks...', 'info');

        try {
            // Mark all as pending
            setChunks(prev => prev.map(c => ({ ...c, cacheStatus: 'pending' as const })));

            const s3Keys = chunks.map(c => c.s3Key);
            addLog(`Checking ${s3Keys.length} chunks in S3...`, 'info');

            const response = await fetch('/api/tts/chunk-cache-check', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ s3Keys }),
            });

            if (!response.ok) {
                const error = await response.json().catch(() => ({ message: 'Unknown error' }));
                addLog(`❌ Failed to check cache: ${error.message || response.statusText}`, 'error');
                setChunks(prev => prev.map(c => ({ ...c, cacheStatus: 'miss' as const })));
                return;
            }

            const data = await response.json();
            const { cacheStatus } = data;

            // Update chunks with cache status
            setChunks(prev => prev.map(chunk => ({
                ...chunk,
                cacheStatus: cacheStatus[chunk.s3Key] ? 'hit' : 'miss',
            })));

            addLog(`✅ Cache check complete: ${data.hits} hits, ${data.misses} misses`, 'success');
            addLog(`Cache hit rate: ${((data.hits / data.total) * 100).toFixed(1)}%`, 'info');

            // Update statistics
            updateStatistics(chunks.map(c => ({
                ...c,
                cacheStatus: cacheStatus[c.s3Key] ? 'hit' : 'miss',
            })));
        } catch (error: any) {
            addLog(`❌ Error checking cache: ${error.message}`, 'error');
            console.error('Error checking cache:', error);
            setChunks(prev => prev.map(c => ({ ...c, cacheStatus: 'miss' as const })));
        } finally {
            setIsCheckingCache(false);
        }
    };

    // Generate TTS with chunk caching (simulation)
    const generateWithChunkCaching = async () => {
        if (chunks.length === 0) {
            addLog('Please process text into chunks first', 'warning');
            return;
        }

        setIsGenerating(true);
        addLog('Generating TTS with chunk caching...', 'info');

        try {
            // First check cache status if not already checked
            if (!chunks[0]?.cacheStatus) {
                addLog('Checking cache status first...', 'info');
                await checkCacheStatus();
            }

            const cachedChunks = chunks.filter(c => c.cacheStatus === 'hit');
            const missingChunks = chunks.filter(c => c.cacheStatus === 'miss');

            addLog(`Found ${cachedChunks.length} cached chunks, ${missingChunks.length} need generation`, 'info');

            // Generate TTS and upload missing chunks to S3
            if (missingChunks.length > 0) {
                addLog(`Generating TTS for ${missingChunks.length} missing chunks...`, 'info');
                
                for (let i = 0; i < missingChunks.length; i++) {
                    const chunk = missingChunks[i];
                    addLog(`[${i + 1}/${missingChunks.length}] Generating TTS for chunk: "${chunk.normalized.substring(0, 50)}..."`, 'info');
                    
                    try {
                        const generateStartTime = Date.now();
                        const response = await fetch('/api/tts/chunk-generate', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ chunkText: chunk.normalized }),
                        });

                        if (!response.ok) {
                            const error = await response.json().catch(() => ({ message: 'Unknown error' }));
                            addLog(`[${i + 1}/${missingChunks.length}] ❌ Failed: ${error.message || response.statusText}`, 'error');
                            continue;
                        }

                        const data = await response.json();
                        const generateTime = Date.now() - generateStartTime;
                        
                        if (data.uploaded) {
                            addLog(`[${i + 1}/${missingChunks.length}] ✅ Generated and uploaded to S3: ${chunk.s3Key} (${(data.audioSize / 1024).toFixed(1)}KB, ${generateTime}ms)`, 'success');
                        } else {
                            addLog(`[${i + 1}/${missingChunks.length}] ✅ Generated (S3 not configured): ${chunk.s3Key} (${(data.audioSize / 1024).toFixed(1)}KB, ${generateTime}ms)`, 'warning');
                        }
                    } catch (error: any) {
                        addLog(`[${i + 1}/${missingChunks.length}] ❌ Error: ${error.message}`, 'error');
                        console.error('Chunk generation error:', error);
                    }
                }
                
                addLog(`✅ Completed processing ${missingChunks.length} chunks`, 'success');
            }

                // Download cached chunks from S3
            const allAudioBuffers: Uint8Array[] = [];
            
            if (cachedChunks.length > 0) {
                addLog(`Downloading ${cachedChunks.length} cached chunks from S3...`, 'info');
                for (let i = 0; i < cachedChunks.length; i++) {
                    const chunk = cachedChunks[i];
                    addLog(`[${i + 1}/${cachedChunks.length}] Downloading from S3: ${chunk.s3Key}`, 'info');
                    
                    try {
                        const downloadStartTime = Date.now();
                        const response = await fetch('/api/tts/chunk-download', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ s3Key: chunk.s3Key }),
                        });

                        if (!response.ok) {
                            const error = await response.json().catch(() => ({ message: 'Unknown error' }));
                            addLog(`[${i + 1}/${cachedChunks.length}] ❌ Download failed: ${error.message || response.statusText}`, 'error');
                            continue;
                        }

                        const data = await response.json();
                        const downloadTime = Date.now() - downloadStartTime;
                        
                        // Convert base64 back to Uint8Array
                        const audioData = Uint8Array.from(atob(data.audioData), c => c.charCodeAt(0));
                        allAudioBuffers.push(audioData);
                        
                        addLog(`[${i + 1}/${cachedChunks.length}] ✅ Downloaded: ${chunk.s3Key} (${(data.audioSize / 1024).toFixed(1)}KB, ${downloadTime}ms)`, 'success');
                    } catch (error: any) {
                        addLog(`[${i + 1}/${cachedChunks.length}] ❌ Error: ${error.message}`, 'error');
                        console.error('Chunk download error:', error);
                    }
                }
                addLog(`✅ Downloaded ${allAudioBuffers.length} cached chunks from S3`, 'success');
            }

            // Generate missing chunks and collect their audio
            if (missingChunks.length > 0) {
                addLog(`Generating TTS for ${missingChunks.length} missing chunks...`, 'info');
                
                for (let i = 0; i < missingChunks.length; i++) {
                    const chunk = missingChunks[i];
                    addLog(`[${i + 1}/${missingChunks.length}] Generating TTS for chunk: "${chunk.normalized.substring(0, 50)}..."`, 'info');
                    
                    try {
                        const generateStartTime = Date.now();
                        const response = await fetch('/api/tts/chunk-generate', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ chunkText: chunk.normalized }),
                        });

                        if (!response.ok) {
                            const error = await response.json().catch(() => ({ message: 'Unknown error' }));
                            addLog(`[${i + 1}/${missingChunks.length}] ❌ Failed: ${error.message || response.statusText}`, 'error');
                            continue;
                        }

                        const data = await response.json();
                        const generateTime = Date.now() - generateStartTime;
                        
                        if (data.uploaded) {
                            addLog(`[${i + 1}/${missingChunks.length}] ✅ Generated and uploaded to S3: ${chunk.s3Key} (${(data.audioSize / 1024).toFixed(1)}KB, ${generateTime}ms)`, 'success');
                            
                            // Use the audio data directly from the response (no need to download again)
                            if (data.audioData) {
                                const audioData = Uint8Array.from(atob(data.audioData), c => c.charCodeAt(0));
                                allAudioBuffers.push(audioData);
                                addLog(`[${i + 1}/${missingChunks.length}] ✅ Added generated chunk to buffer`, 'success');
                            }
                        } else {
                            addLog(`[${i + 1}/${missingChunks.length}] ✅ Generated (S3 not configured): ${chunk.s3Key} (${(data.audioSize / 1024).toFixed(1)}KB, ${generateTime}ms)`, 'warning');
                            
                            // Still use the audio data even if S3 upload failed
                            if (data.audioData) {
                                const audioData = Uint8Array.from(atob(data.audioData), c => c.charCodeAt(0));
                                allAudioBuffers.push(audioData);
                            }
                        }
                    } catch (error: any) {
                        addLog(`[${i + 1}/${missingChunks.length}] ❌ Error: ${error.message}`, 'error');
                        console.error('Chunk generation error:', error);
                    }
                }
                
                addLog(`✅ Completed processing ${missingChunks.length} chunks`, 'success');
            }

            // Concatenate all audio buffers
            if (allAudioBuffers.length > 0) {
                addLog(`Concatenating ${allAudioBuffers.length} audio chunks...`, 'info');
                const concatStartTime = Date.now();
                
                // Simple WAV concatenation: keep first header, append data from others
                // For proper WAV concatenation, we'd need to strip headers and update the file size
                // This is a simplified version that works for basic cases
                const totalLength = allAudioBuffers.reduce((sum, buf) => sum + buf.length, 0);
                const concatenated = new Uint8Array(totalLength);
                let offset = 0;
                
                for (const buffer of allAudioBuffers) {
                    concatenated.set(buffer, offset);
                    offset += buffer.length;
                }
                
                const concatTime = Date.now() - concatStartTime;
                addLog(`✅ Audio concatenation complete (${(totalLength / 1024).toFixed(1)}KB, ${concatTime}ms)`, 'success');

                // Create blob URL for playback
                const blob = new Blob([concatenated], { type: 'audio/wav' });
                const url = URL.createObjectURL(blob);
                setAudioUrl(url);

                addLog(`✅ Audio ready for playback (${(totalLength / 1024).toFixed(1)}KB total)`, 'success');
                addLog(`Saved ${cachedChunks.length} TTS API calls (${((cachedChunks.length / chunks.length) * 100).toFixed(1)}% reduction)`, 'success');
            } else {
                addLog(`⚠️ No audio chunks available to concatenate`, 'warning');
            }
        } catch (error: any) {
            addLog(`❌ Error: ${error.message}`, 'error');
            console.error('TTS generation error:', error);
        } finally {
            setIsGenerating(false);
        }
    };

    // Update statistics
    const updateStatistics = (currentChunks: ChunkWithStatus[]) => {
        const hits = currentChunks.filter(c => c.cacheStatus === 'hit').length;
        const misses = currentChunks.filter(c => c.cacheStatus === 'miss').length;
        const total = currentChunks.length;
        const hitRate = total > 0 ? (hits / total) * 100 : 0;

        // Estimate: each TTS call takes ~2 seconds, saves ~$0.001 per call
        const estimatedTTSSaved = hits;
        const estimatedTimeSaved = hits * 2; // seconds

        setStatistics({
            totalChunks: total,
            cacheHits: hits,
            cacheMisses: misses,
            hitRate,
            estimatedTTSSaved,
            estimatedTimeSaved,
        });
    };

    // Check S3 configuration and connection
    const checkS3Config = async () => {
        setIsTestingS3(true);
        addLog('Testing S3 connection...', 'info');

        try {
            const response = await fetch('/api/s3/test', {
                method: 'GET',
            });

            const data = await response.json();

            if (data.configured) {
                if (data.connected) {
                    addLog(`✅ S3 connection successful!`, 'success');
                    addLog(`Bucket: ${data.bucket}`, 'info');
                    addLog(`Region: ${data.region}`, 'info');
                    addLog(`Connection time: ${data.connectionTime}ms`, 'info');
                    setS3Status({
                        configured: true,
                        connected: true,
                        bucket: data.bucket,
                        region: data.region,
                        message: data.message,
                    });
                } else {
                    addLog(`❌ S3 configured but connection failed`, 'error');
                    addLog(`Error: ${data.error} - ${data.message}`, 'error');
                    setS3Status({
                        configured: true,
                        connected: false,
                        bucket: data.bucket,
                        region: data.region,
                        error: data.error,
                        message: data.message,
                    });
                }
            } else {
                addLog(`⚠️ S3 not configured`, 'warning');
                if (data.missing && data.missing.length > 0) {
                    addLog(`Missing environment variables: ${data.missing.join(', ')}`, 'warning');
                }
                setS3Status({
                    configured: false,
                    connected: false,
                    error: data.error,
                    message: data.message,
                    missing: data.missing,
                });
            }
        } catch (error: any) {
            addLog(`❌ Failed to test S3 connection: ${error.message}`, 'error');
            setS3Status({
                configured: false,
                connected: false,
                error: 'NetworkError',
                message: error.message,
            });
        } finally {
            setIsTestingS3(false);
        }
    };

    // Load test scenario
    const loadScenario = (scenario: keyof typeof TEST_SCENARIOS) => {
        setText(TEST_SCENARIOS[scenario]);
        addLog(`Loaded ${scenario} test scenario`, 'info');
    };

    // Toggle chunk expansion
    const toggleChunk = (index: number) => {
        setChunks(prev => prev.map((c, i) => 
            i === index ? { ...c, isExpanded: !c.isExpanded } : c
        ));
    };

    // Auto-process when text changes (debounced)
    useEffect(() => {
        const timer = setTimeout(() => {
            if (text.trim()) {
                processText();
            }
        }, 500);

        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [text]);

    return (
        <div className="min-h-screen bg-gray-50 p-8">
            <div className="max-w-6xl mx-auto">
                <h1 className="text-3xl font-bold mb-6">Chunk Caching Test</h1>

                {/* S3 Connection Test */}
                <div className="bg-white rounded-lg shadow p-6 mb-6">
                    <h2 className="text-xl font-semibold mb-4">S3 Connection Test</h2>
                    <button
                        onClick={checkS3Config}
                        disabled={isTestingS3}
                        className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-400 disabled:cursor-not-allowed"
                    >
                        {isTestingS3 ? 'Testing...' : 'Test S3 Connection'}
                    </button>

                    {s3Status && (
                        <div className={`mt-4 p-4 rounded ${
                            s3Status.connected
                                ? 'bg-green-50 border border-green-200'
                                : s3Status.configured
                                    ? 'bg-red-50 border border-red-200'
                                    : 'bg-yellow-50 border border-yellow-200'
                        }`}>
                            <div className="flex items-start gap-2">
                                {s3Status.connected ? (
                                    <span className="text-green-600 font-bold">✓</span>
                                ) : s3Status.configured ? (
                                    <span className="text-red-600 font-bold">✗</span>
                                ) : (
                                    <span className="text-yellow-600 font-bold">⚠</span>
                                )}
                                <div className="flex-1">
                                    <p className={`font-semibold ${
                                        s3Status.connected
                                            ? 'text-green-800'
                                            : s3Status.configured
                                                ? 'text-red-800'
                                                : 'text-yellow-800'
                                    }`}>
                                        {s3Status.connected
                                            ? 'S3 Connection Successful'
                                            : s3Status.configured
                                                ? 'S3 Connection Failed'
                                                : 'S3 Not Configured'}
                                    </p>
                                    {s3Status.bucket && (
                                        <p className="text-sm text-gray-700 mt-1">
                                            Bucket: <span className="font-mono">{s3Status.bucket}</span>
                                        </p>
                                    )}
                                    {s3Status.region && (
                                        <p className="text-sm text-gray-700">
                                            Region: <span className="font-mono">{s3Status.region}</span>
                                        </p>
                                    )}
                                    {s3Status.message && (
                                        <p className="text-sm text-gray-700 mt-1">{s3Status.message}</p>
                                    )}
                                    {s3Status.error && (
                                        <p className="text-sm text-red-700 mt-1">
                                            Error: {s3Status.error}
                                        </p>
                                    )}
                                    {s3Status.missing && s3Status.missing.length > 0 && (
                                        <div className="mt-2">
                                            <p className="text-sm font-semibold text-yellow-800">Missing Environment Variables:</p>
                                            <ul className="list-disc list-inside text-sm text-yellow-700 mt-1">
                                                {s3Status.missing.map((env, idx) => (
                                                    <li key={idx} className="font-mono">{env}</li>
                                                ))}
                                            </ul>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    <p className="mt-2 text-sm text-gray-600">
                        This tests the S3 connection by attempting to access the configured bucket.
                        Check server console logs for detailed connection information.
                    </p>
                </div>

                {/* Test Scenarios */}
                <div className="bg-white rounded-lg shadow p-6 mb-6">
                    <h2 className="text-xl font-semibold mb-4">Test Scenarios</h2>
                    <div className="flex gap-2 flex-wrap">
                        <button
                            onClick={() => loadScenario('repeated')}
                            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 text-sm"
                        >
                            Repeated Phrases
                        </button>
                        <button
                            onClick={() => loadScenario('unique')}
                            className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 text-sm"
                        >
                            Unique Text
                        </button>
                        <button
                            onClick={() => loadScenario('mixed')}
                            className="px-4 py-2 bg-purple-500 text-white rounded hover:bg-purple-600 text-sm"
                        >
                            Mixed Content
                        </button>
                        <button
                            onClick={() => loadScenario('long')}
                            className="px-4 py-2 bg-orange-500 text-white rounded hover:bg-orange-600 text-sm"
                        >
                            Long Sentence
                        </button>
                    </div>
                </div>

                {/* Text Input */}
                <div className="bg-white rounded-lg shadow p-6 mb-6">
                    <h2 className="text-xl font-semibold mb-4">Text Input</h2>
                    <textarea
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        className="w-full p-2 border rounded"
                        rows={4}
                        placeholder="Enter text to test chunk caching..."
                    />
                    <p className="text-xs text-gray-500 mt-2">
                        Text will be automatically processed into chunks when you stop typing.
                    </p>
                </div>

                {/* Statistics */}
                {statistics && (
                    <div className="bg-white rounded-lg shadow p-6 mb-6">
                        <h2 className="text-xl font-semibold mb-4">Statistics</h2>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <div className="bg-gray-50 p-4 rounded">
                                <div className="text-sm text-gray-600">Total Chunks</div>
                                <div className="text-2xl font-bold">{statistics.totalChunks}</div>
                            </div>
                            <div className="bg-green-50 p-4 rounded">
                                <div className="text-sm text-gray-600">Cache Hits</div>
                                <div className="text-2xl font-bold text-green-600">{statistics.cacheHits}</div>
                            </div>
                            <div className="bg-red-50 p-4 rounded">
                                <div className="text-sm text-gray-600">Cache Misses</div>
                                <div className="text-2xl font-bold text-red-600">{statistics.cacheMisses}</div>
                            </div>
                            <div className="bg-blue-50 p-4 rounded">
                                <div className="text-sm text-gray-600">Hit Rate</div>
                                <div className="text-2xl font-bold text-blue-600">{statistics.hitRate.toFixed(1)}%</div>
                            </div>
                        </div>
                        <div className="mt-4 grid grid-cols-2 gap-4">
                            <div className="bg-yellow-50 p-4 rounded">
                                <div className="text-sm text-gray-600">TTS Calls Saved</div>
                                <div className="text-xl font-bold text-yellow-600">{statistics.estimatedTTSSaved}</div>
                            </div>
                            <div className="bg-indigo-50 p-4 rounded">
                                <div className="text-sm text-gray-600">Time Saved (est.)</div>
                                <div className="text-xl font-bold text-indigo-600">{statistics.estimatedTimeSaved}s</div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Chunks Display */}
                <div className="bg-white rounded-lg shadow p-6 mb-6">
                    <div className="flex justify-between items-center mb-4">
                        <h2 className="text-xl font-semibold">Chunks ({chunks.length})</h2>
                        <div className="flex gap-2">
                            <button
                                onClick={checkCacheStatus}
                                disabled={isCheckingCache || chunks.length === 0}
                                className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-400 disabled:cursor-not-allowed text-sm"
                            >
                                {isCheckingCache ? 'Checking...' : 'Check Cache Status'}
                            </button>
                            <button
                                onClick={generateWithChunkCaching}
                                disabled={isGenerating || chunks.length === 0}
                                className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 disabled:bg-gray-400 disabled:cursor-not-allowed text-sm"
                            >
                                {isGenerating ? 'Generating...' : 'Generate with Chunk Caching'}
                            </button>
                        </div>
                    </div>

                    {chunks.length === 0 ? (
                        <p className="text-gray-500">No chunks yet. Enter text above to process.</p>
                    ) : (
                        <div className="space-y-2">
                            {chunks.map((chunk, index) => {
                                const statusColor = 
                                    chunk.cacheStatus === 'hit' ? 'bg-green-50 border-green-200' :
                                    chunk.cacheStatus === 'miss' ? 'bg-red-50 border-red-200' :
                                    chunk.cacheStatus === 'pending' ? 'bg-yellow-50 border-yellow-200' :
                                    'bg-gray-50 border-gray-200';

                                const statusIcon = 
                                    chunk.cacheStatus === 'hit' ? '✓' :
                                    chunk.cacheStatus === 'miss' ? '✗' :
                                    chunk.cacheStatus === 'pending' ? '⏳' :
                                    '?';

                                return (
                                    <div
                                        key={index}
                                        className={`border rounded p-3 ${statusColor} cursor-pointer`}
                                        onClick={() => toggleChunk(index)}
                                    >
                                        <div className="flex items-start justify-between">
                                            <div className="flex-1">
                                                <div className="flex items-center gap-2 mb-1">
                                                    <span className="font-bold text-sm">Chunk {index + 1}</span>
                                                    <span className={`text-lg ${chunk.cacheStatus === 'hit' ? 'text-green-600' : chunk.cacheStatus === 'miss' ? 'text-red-600' : 'text-gray-400'}`}>
                                                        {statusIcon}
                                                    </span>
                                                    {!chunk.isValidLength && (
                                                        <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded">
                                                            Too Long
                                                        </span>
                                                    )}
                                                </div>
                                                <p className="text-sm text-gray-700">
                                                    {chunk.original.length > 100 ? `${chunk.original.substring(0, 100)}...` : chunk.original}
                                                </p>
                                            </div>
                                            <span className="text-xs text-gray-500 ml-2">
                                                {chunk.isExpanded ? '▼' : '▶'}
                                            </span>
                                        </div>

                                        {chunk.isExpanded && (
                                            <div className="mt-3 pt-3 border-t border-gray-300 space-y-2 text-xs">
                                                <div>
                                                    <span className="font-semibold">Original:</span>
                                                    <p className="text-gray-600 mt-1">{chunk.original}</p>
                                                </div>
                                                <div>
                                                    <span className="font-semibold">Normalized:</span>
                                                    <p className="text-gray-600 mt-1 font-mono">{chunk.normalized}</p>
                                                </div>
                                                <div>
                                                    <span className="font-semibold">Hash:</span>
                                                    <p className="text-gray-600 mt-1 font-mono break-all">{chunk.hash}</p>
                                                </div>
                                                <div>
                                                    <span className="font-semibold">S3 Key:</span>
                                                    <p className="text-gray-600 mt-1 font-mono break-all">{chunk.s3Key}</p>
                                                </div>
                                                <div>
                                                    <span className="font-semibold">Length:</span>
                                                    <span className="text-gray-600 ml-2">{chunk.normalized.length} chars</span>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Audio Player */}
                {audioUrl && (
                    <div className="bg-white rounded-lg shadow p-6 mb-6">
                        <h2 className="text-xl font-semibold mb-4">Audio Player</h2>
                        <audio controls src={audioUrl} className="w-full" />
                        <button
                            onClick={() => {
                                if (audioUrl) {
                                    URL.revokeObjectURL(audioUrl);
                                    setAudioUrl(null);
                                }
                            }}
                            className="mt-2 px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600"
                        >
                            Clear Audio
                        </button>
                    </div>
                )}

                {/* Logs */}
                <div className="bg-white rounded-lg shadow p-6">
                    <div className="flex justify-between items-center mb-4">
                        <h2 className="text-xl font-semibold">Test Logs</h2>
                        <button
                            onClick={clearLogs}
                            className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600 text-sm"
                        >
                            Clear Logs
                        </button>
                    </div>
                    <div className="bg-gray-900 text-green-400 font-mono text-sm p-4 rounded max-h-96 overflow-y-auto">
                        {logs.length === 0 ? (
                            <p className="text-gray-500">No logs yet. Run a test to see logs here.</p>
                        ) : (
                            logs.map((log, index) => {
                                const colorMap = {
                                    info: 'text-blue-400',
                                    success: 'text-green-400',
                                    error: 'text-red-400',
                                    warning: 'text-yellow-400',
                                };
                                return (
                                    <div key={index} className={colorMap[log.type]}>
                                        <span className="text-gray-500">[{log.time}]</span> {log.message}
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

