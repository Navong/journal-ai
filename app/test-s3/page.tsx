'use client';

import { useState } from 'react';

interface TestLog {
    time: string;
    message: string;
    type: 'info' | 'success' | 'error' | 'warning';
}

export default function TestS3Page() {
    const [text, setText] = useState('Hello, this is a test of the S3 audio streaming system.');
    const [isGenerating, setIsGenerating] = useState(false);
    const [isFetching, setIsFetching] = useState(false);
    const [logs, setLogs] = useState<TestLog[]>([]);
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const [entryId, setEntryId] = useState<string>('');
    const [testEntryId, setTestEntryId] = useState<string>('');
    const [s3Key, setS3Key] = useState<string>('');
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

    // Test TTS generation with S3 upload
    const testTTSGeneration = async () => {
        setIsGenerating(true);
        addLog('Starting TTS generation test...', 'info');

        try {
            let entryIdToUse = testEntryId.trim();

            // Auto-create a test journal entry if no entryId provided
            if (!entryIdToUse) {
                addLog('No entryId provided - creating a test journal entry...', 'info');
                try {
                    const testEntry = {
                        id: `test_${Date.now()}_${Math.random().toString(36).substring(7)}`,
                        entry_text: text,
                        reflection_text: `Test reflection for: ${text}`,
                        summary: 'Test entry for S3 audio streaming',
                        topic: 'Test',
                        mood: 'calm' as const,
                        created_at: new Date().toISOString(),
                    };

                    const createResponse = await fetch('/api/history', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ entries: [testEntry] }),
                    });

                    if (createResponse.ok) {
                        entryIdToUse = testEntry.id;
                        setTestEntryId(entryIdToUse);
                        addLog(`✅ Created test journal entry: ${entryIdToUse}`, 'success');
                        addLog('This entry ID will be used to save the S3 key', 'info');
                    } else {
                        const error = await createResponse.json().catch(() => ({ message: 'Unknown error' }));
                        addLog(`⚠️ Failed to create test entry: ${error.message || createResponse.statusText}`, 'warning');
                        addLog('Continuing without entryId - S3 key will not be saved to database', 'warning');
                    }
                } catch (createError: any) {
                    addLog(`⚠️ Failed to create test entry: ${createError.message}`, 'warning');
                    addLog('Continuing without entryId - S3 key will not be saved to database', 'warning');
                }
            } else {
                addLog(`Using provided entryId: ${entryIdToUse}`, 'info');
            }

            addLog(`Generating TTS for: "${text}"`, 'info');
            const requestBody: { text: string; entryId?: string } = { text };
            if (entryIdToUse) {
                requestBody.entryId = entryIdToUse;
                addLog(`Including entryId in request: ${entryIdToUse}`, 'info');
            }

            const response = await fetch('/api/tts', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestBody),
            });

            if (!response.ok) {
                const error = await response.json().catch(() => ({ message: 'Unknown error' }));
                addLog(`TTS generation failed: ${error.message || response.statusText}`, 'error');
                setIsGenerating(false);
                return;
            }

            if (!response.body) {
                addLog('No response body received', 'error');
                setIsGenerating(false);
                return;
            }

            addLog('✅ TTS stream received, starting playback...', 'success');

            // Convert stream to blob for playback
            const chunks: Uint8Array[] = [];
            const reader = response.body.getReader();
            let totalSize = 0;
            let chunkCount = 0;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                if (value) {
                    chunks.push(value);
                    totalSize += value.length;
                    chunkCount++;
                    if (chunkCount <= 5 || chunkCount % 20 === 0) {
                        addLog(`Received chunk ${chunkCount}: ${(totalSize / 1024).toFixed(1)}KB`, 'info');
                    }
                }
            }

            addLog(`✅ Stream complete: ${chunkCount} chunks, ${(totalSize / 1024).toFixed(1)}KB`, 'success');

            // Combine chunks
            const audioBuffer = new Uint8Array(totalSize);
            let offset = 0;
            for (const chunk of chunks) {
                audioBuffer.set(chunk, offset);
                offset += chunk.length;
            }

            // Create blob URL for playback
            const blob = new Blob([audioBuffer], { type: 'audio/wav' });
            const url = URL.createObjectURL(blob);
            setAudioUrl(url);

            addLog('✅ Audio ready for playback (check server logs for S3 upload status)', 'success');
            addLog('Note: S3 upload happens in background - check server console for upload logs', 'info');

            // Calculate and show expected S3 key
            try {
                const keyResponse = await fetch('/api/s3/get-key', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text }),
                });

                if (keyResponse.ok) {
                    const keyData = await keyResponse.json();
                    setS3Key(keyData.s3Key);
                    addLog(`Expected S3 key: ${keyData.s3Key}`, 'info');
                    addLog('Note: Check server logs to confirm if S3 upload completed successfully', 'info');
                    if (entryIdToUse) {
                        addLog(`Entry ID: ${entryIdToUse} - S3 key should be saved to database`, 'info');
                        addLog('Wait a few seconds for background upload to complete, then try "Get S3 Key"', 'info');
                        addLog(`You can use this entry ID to fetch the S3 key: ${entryIdToUse}`, 'info');
                    } else {
                        addLog('⚠️ No entryId available - S3 key was NOT saved to database', 'warning');
                        addLog('The S3 upload succeeded, but the key was not linked to a journal entry', 'warning');
                    }
                }
            } catch (keyError) {
                addLog('Could not calculate S3 key (non-critical)', 'warning');
            }

        } catch (error: any) {
            addLog(`❌ Error: ${error.message}`, 'error');
            console.error('TTS generation error:', error);
        } finally {
            setIsGenerating(false);
        }
    };

    // Test fetching audio from database/S3
    const testFetchAudio = async () => {
        if (!entryId.trim()) {
            addLog('Please enter an entry ID', 'warning');
            return;
        }

        setIsFetching(true);
        addLog(`Fetching audio for entry: ${entryId}`, 'info');

        try {
            // Test streaming mode
            const response = await fetch(`/api/history/audio?entryId=${encodeURIComponent(entryId)}&streaming=true`, {
                method: 'GET',
            });

            if (!response.ok) {
                const error = await response.json().catch(() => ({ message: 'Unknown error' }));
                addLog(`❌ Fetch failed: ${error.message || response.statusText} (${response.status})`, 'error');
                setIsFetching(false);
                return;
            }

            const contentType = response.headers.get('Content-Type');
            addLog(`Response Content-Type: ${contentType}`, 'info');

            if (contentType?.includes('application/json')) {
                // JSON response (S3 URL or audioData)
                const data = await response.json();
                if (data.audioS3Url) {
                    addLog(`✅ Received S3 URL: ${data.audioS3Url.substring(0, 100)}...`, 'success');
                    setS3Key(data.audioS3Key || '');

                    // Fetch from S3
                    addLog('Fetching audio from S3...', 'info');
                    const s3Response = await fetch(data.audioS3Url);
                    if (s3Response.ok) {
                        const blob = await s3Response.blob();
                        const url = URL.createObjectURL(blob);
                        setAudioUrl(url);
                        addLog(`✅ Audio fetched from S3: ${(blob.size / 1024).toFixed(1)}KB`, 'success');
                    } else {
                        addLog(`❌ S3 fetch failed: ${s3Response.status} ${s3Response.statusText}`, 'error');
                    }
                } else if (data.audioData) {
                    addLog('✅ Received audioData (fallback mode)', 'info');
                    // Handle base64 audioData
                    const blob = new Blob([Uint8Array.from(atob(data.audioData), c => c.charCodeAt(0))], { type: 'audio/wav' });
                    const url = URL.createObjectURL(blob);
                    setAudioUrl(url);
                }
            } else if (contentType?.includes('audio/')) {
                // Streaming binary response
                addLog('✅ Received streaming audio response', 'success');

                const chunks: Uint8Array[] = [];
                const reader = response.body!.getReader();
                let totalSize = 0;
                let chunkCount = 0;

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    if (value) {
                        chunks.push(value);
                        totalSize += value.length;
                        chunkCount++;
                    }
                }

                addLog(`✅ Stream complete: ${chunkCount} chunks, ${(totalSize / 1024).toFixed(1)}KB`, 'success');

                const audioBuffer = new Uint8Array(totalSize);
                let offset = 0;
                for (const chunk of chunks) {
                    audioBuffer.set(chunk, offset);
                    offset += chunk.length;
                }

                const blob = new Blob([audioBuffer], { type: 'audio/wav' });
                const url = URL.createObjectURL(blob);
                setAudioUrl(url);
            }
        } catch (error: any) {
            addLog(`❌ Error: ${error.message}`, 'error');
            console.error('Fetch audio error:', error);
        } finally {
            setIsFetching(false);
        }
    };

    // Test S3 key retrieval
    const testGetS3Key = async () => {
        if (!entryId.trim()) {
            addLog('Please enter an entry ID', 'warning');
            return;
        }

        // Check if user entered an S3 key instead of entry ID
        if (entryId.includes('/') || entryId.endsWith('.wav')) {
            addLog('⚠️ It looks like you entered an S3 key instead of an entry ID', 'warning');
            addLog('Entry ID should be a UUID (e.g., "123e4567-e89b-12d3-a456-426614174000")', 'info');
            addLog('S3 key example: "audio/userId/hash.wav"', 'info');
            addLog('Please enter the journal entry ID (UUID), not the S3 key', 'warning');
            setS3Key('');
            return;
        }

        addLog(`Getting S3 key for entry: ${entryId}`, 'info');

        try {
            const response = await fetch(`/api/history/audio/s3key?entryId=${encodeURIComponent(entryId)}`, {
                method: 'GET',
            });

            if (!response.ok) {
                if (response.status === 404) {
                    const errorData = await response.json().catch(() => ({}));
                    if (errorData.error === 'Entry not found') {
                        addLog('❌ Entry not found in database', 'error');
                        addLog('Please verify the entry ID is correct (should be a UUID)', 'info');
                        addLog('Example entry ID format: "123e4567-e89b-12d3-a456-426614174000"', 'info');
                    } else {
                        addLog('❌ No S3 key found for this entry in database', 'warning');
                        addLog('This means either:', 'info');
                        addLog('1. The entry does not have audio yet', 'info');
                        addLog('2. The S3 upload failed (check server logs)', 'info');
                        addLog('3. The entryId was not provided when generating TTS', 'info');
                        addLog('4. The background upload is still in progress (wait a few seconds)', 'info');
                    }
                    setS3Key('');
                    return;
                }
                const error = await response.json().catch(() => ({ message: 'Unknown error' }));
                addLog(`❌ Failed to get S3 key: ${error.message || response.statusText}`, 'error');
                return;
            }

            const data = await response.json();
            if (data.s3Key) {
                setS3Key(data.s3Key);
                addLog(`✅ S3 key found in database: ${data.s3Key}`, 'success');
                addLog('This entry has audio stored in S3', 'success');
            } else {
                addLog('No S3 key in response', 'warning');
                setS3Key('');
            }
        } catch (error: any) {
            addLog(`❌ Error: ${error.message}`, 'error');
            console.error('Get S3 key error:', error);
        }
    };

    // Calculate expected S3 key from text
    const calculateS3Key = async () => {
        if (!text.trim()) {
            addLog('Please enter text to calculate S3 key', 'warning');
            return;
        }

        addLog(`Calculating expected S3 key for text...`, 'info');

        try {
            const response = await fetch('/api/s3/get-key', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text }),
            });

            if (!response.ok) {
                const error = await response.json().catch(() => ({ message: 'Unknown error' }));
                addLog(`❌ Failed to calculate S3 key: ${error.message || response.statusText}`, 'error');
                return;
            }

            const data = await response.json();
            setS3Key(data.s3Key);
            addLog(`✅ Expected S3 key: ${data.s3Key}`, 'success');
            addLog(`Text hash: ${data.textHash}`, 'info');
            addLog(`Voice ID: ${data.voiceId}`, 'info');
            addLog('Note: This is the expected key. Check if it exists in database for your entry.', 'info');
        } catch (error: any) {
            addLog(`❌ Error: ${error.message}`, 'error');
            console.error('Calculate S3 key error:', error);
        }
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

    return (
        <div className="min-h-screen bg-gray-50 p-8">
            <div className="max-w-4xl mx-auto">
                <h1 className="text-3xl font-bold mb-6">S3 Audio Streaming Test</h1>

                {/* Configuration Check */}
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
                        <div className={`mt-4 p-4 rounded ${s3Status.connected
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
                                    <p className={`font-semibold ${s3Status.connected
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

                {/* TTS Generation Test */}
                <div className="bg-white rounded-lg shadow p-6 mb-6">
                    <h2 className="text-xl font-semibold mb-4">Test 1: TTS Generation with S3 Upload</h2>
                    <div className="mb-4">
                        <label className="block text-sm font-medium mb-2">Text to generate:</label>
                        <textarea
                            value={text}
                            onChange={(e) => setText(e.target.value)}
                            className="w-full p-2 border rounded"
                            rows={3}
                            placeholder="Enter text to generate audio..."
                        />
                    </div>
                    <div className="mb-4">
                        <label className="block text-sm font-medium mb-2">
                            Entry ID (optional - auto-created if not provided):
                        </label>
                        <input
                            type="text"
                            value={testEntryId}
                            onChange={(e) => setTestEntryId(e.target.value)}
                            className="w-full p-2 border rounded"
                            placeholder="Leave empty to auto-create a test entry, or enter existing entry ID..."
                        />
                        <p className="text-xs text-gray-500 mt-1">
                            💡 <strong>Auto-create mode:</strong> If left empty, a test journal entry will be automatically created and the S3 key will be saved to it.
                            <br />
                            📝 <strong>Manual mode:</strong> Enter an existing journal entry ID (UUID) to save the S3 key to that entry.
                            <br />
                            Example UUID: <span className="font-mono text-xs">123e4567-e89b-12d3-a456-426614174000</span>
                        </p>
                    </div>
                    <button
                        onClick={testTTSGeneration}
                        disabled={isGenerating || !text.trim()}
                        className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 disabled:bg-gray-400 disabled:cursor-not-allowed"
                    >
                        {isGenerating ? 'Generating...' : 'Generate TTS (Stream + S3 Upload)'}
                    </button>
                    <p className="mt-2 text-sm text-gray-600">
                        This will generate TTS, stream to client, and upload to S3 in background (check server logs)
                    </p>
                </div>

                {/* Audio Fetch Test */}
                <div className="bg-white rounded-lg shadow p-6 mb-6">
                    <h2 className="text-xl font-semibold mb-4">Test 2: Fetch Audio from Database/S3</h2>
                    <div className="mb-4">
                        <label className="block text-sm font-medium mb-2">Entry ID:</label>
                        <input
                            type="text"
                            value={entryId}
                            onChange={(e) => setEntryId(e.target.value)}
                            className="w-full p-2 border rounded"
                            placeholder="Enter journal entry ID..."
                        />
                    </div>
                    <div className="flex gap-2 flex-wrap">
                        <button
                            onClick={testFetchAudio}
                            disabled={isFetching || !entryId.trim()}
                            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-400 disabled:cursor-not-allowed"
                        >
                            {isFetching ? 'Fetching...' : 'Fetch Audio (Streaming)'}
                        </button>
                        <button
                            onClick={testGetS3Key}
                            disabled={!entryId.trim()}
                            className="px-4 py-2 bg-purple-500 text-white rounded hover:bg-purple-600 disabled:bg-gray-400 disabled:cursor-not-allowed"
                        >
                            Get S3 Key from DB
                        </button>
                    </div>
                    <div className="mt-2">
                        <button
                            onClick={calculateS3Key}
                            disabled={!text.trim()}
                            className="px-4 py-2 bg-indigo-500 text-white rounded hover:bg-indigo-600 disabled:bg-gray-400 disabled:cursor-not-allowed text-sm"
                        >
                            Calculate Expected S3 Key
                        </button>
                        <p className="text-xs text-gray-500 mt-1">
                            Calculate the expected S3 key from text (useful for debugging)
                        </p>
                    </div>
                    {s3Key && (
                        <div className="mt-2 p-2 bg-gray-100 rounded">
                            <p className="text-sm font-mono break-all">S3 Key: {s3Key}</p>
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
                    <p className="mt-2 text-sm text-gray-600">
                        Check browser console and server console for detailed logs
                    </p>
                </div>

                {/* Instructions */}
                <div className="bg-blue-50 rounded-lg p-6 mt-6">
                    <h3 className="font-semibold mb-2">How to Test:</h3>
                    <ol className="list-decimal list-inside space-y-2 text-sm">
                        <li>Generate TTS audio - This will stream audio and upload to S3 in background</li>
                        <li>Check server console for S3 upload logs (look for [TTS API] [S3 Upload] logs)</li>
                        <li>Find the entry ID from your journal entries (or create a test entry)</li>
                        <li>Fetch audio using the entry ID - Should fetch from S3 if uploaded successfully</li>
                        <li>Check logs for any errors or issues</li>
                    </ol>
                    <p className="mt-4 text-sm font-semibold">Important:</p>
                    <ul className="list-disc list-inside space-y-1 text-sm">
                        <li>S3 must be configured in environment variables (AWS_S3_BUCKET_NAME, etc.)</li>
                        <li>Check server console logs for detailed S3 operation logs</li>
                        <li>If S3 is not configured, audio will still work but won't upload to S3</li>
                        <li>Background S3 upload happens after streaming completes</li>
                    </ul>
                </div>
            </div>
        </div>
    );
}

