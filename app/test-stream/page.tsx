'use client';

import React, { useState, useCallback } from 'react';
import { getJournalReflectionStream } from '../services/journalAIService';
import { StreamingCallback } from '../services/providers/llm/interface';
import { showToast, ToastContainer } from '../utils/toast';

export default function TestStreamPage() {
  const [entry, setEntry] = useState<string>('');
  const [streamingText, setStreamingText] = useState<string>('');
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [finalResult, setFinalResult] = useState<any>(null);

  const handleTestStream = useCallback(async () => {
    if (!entry.trim()) return;

    setIsStreaming(true);
    setStreamingText('');
    setFinalResult(null);

    try {
      const streamingCallback: StreamingCallback = (chunk) => {
        setStreamingText(prev => prev + chunk.text);

        if (chunk.isComplete) {
          console.log('Streaming completed');
        }
      };

      const result = await getJournalReflectionStream(
        entry,
        'none',
        [], // Empty history for testing
        streamingCallback,
        (progress) => {
          console.log('Progress:', progress);
        }
      );

      setFinalResult(result);
      setIsStreaming(false);
      showToast('Streaming test completed!', 'success');
    } catch (error) {
      console.error('Streaming test failed:', error);
      setIsStreaming(false);
      showToast('Streaming test failed', 'error');
    }
  }, [entry]);

  return (
    <div className="min-h-screen bg-[#FDFCF8] px-4 py-8 max-w-4xl mx-auto">
      <ToastContainer />

      <div className="mb-8">
        <h1 className="text-3xl font-light text-stone-800 mb-2">Gemini Streaming Test</h1>
        <p className="text-stone-600">Test the real-time streaming functionality of Gemini reflections</p>
      </div>

      <div className="space-y-6">
        {/* Input Section */}
        <div className="bg-white rounded-lg border border-stone-200 p-6">
          <h2 className="text-xl font-medium text-stone-800 mb-4">Test Input</h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-2">
                Journal Entry Text
              </label>
              <textarea
                value={entry}
                onChange={(e) => setEntry(e.target.value)}
                placeholder="Enter some text to reflect on..."
                className="w-full min-h-[120px] p-3 border border-stone-300 rounded-md focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 resize-vertical"
                disabled={isStreaming}
              />
            </div>

            <button
              onClick={handleTestStream}
              disabled={!entry.trim() || isStreaming}
              className={`px-6 py-3 rounded-md font-medium transition-colors ${
                isStreaming
                  ? 'bg-stone-400 text-white cursor-not-allowed'
                  : !entry.trim()
                  ? 'bg-stone-200 text-stone-400 cursor-not-allowed'
                  : 'bg-emerald-600 text-white hover:bg-emerald-700'
              }`}
            >
              {isStreaming ? 'Streaming...' : 'Start Streaming Test'}
            </button>
          </div>
        </div>

        {/* Streaming Output Section */}
        {(streamingText || isStreaming) && (
          <div className="bg-white rounded-lg border border-stone-200 p-6">
            <h2 className="text-xl font-medium text-stone-800 mb-4 flex items-center gap-2">
              Streaming Output
              {isStreaming && (
                <div className="flex items-center gap-2 text-emerald-600">
                  <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
                  <span className="text-sm font-normal">Live streaming...</span>
                </div>
              )}
            </h2>

            <div className="bg-stone-50 rounded-md p-4 min-h-[120px]">
              <div className="text-stone-800 whitespace-pre-wrap leading-relaxed">
                {streamingText}
                {isStreaming && <span className="inline-block w-2 h-4 bg-emerald-500 ml-1 animate-pulse"></span>}
              </div>
              {!streamingText && isStreaming && (
                <div className="text-stone-400 italic">Waiting for streaming to begin...</div>
              )}
            </div>
          </div>
        )}

        {/* Final Result Section */}
        {finalResult && (
          <div className="bg-white rounded-lg border border-stone-200 p-6">
            <h2 className="text-xl font-medium text-stone-800 mb-4">Final Result</h2>

            <div className="space-y-4">
              <div>
                <h3 className="font-medium text-stone-700 mb-2">Summary</h3>
                <p className="text-stone-600 italic">"{finalResult.summary}"</p>
              </div>

              {finalResult.topic && (
                <div>
                  <h3 className="font-medium text-stone-700 mb-2">Topic</h3>
                  <p className="text-stone-600">{finalResult.topic}</p>
                </div>
              )}

              {finalResult.mood && (
                <div>
                  <h3 className="font-medium text-stone-700 mb-2">Mood</h3>
                  <p className="text-stone-600">{finalResult.mood}</p>
                </div>
              )}

              {finalResult.entities && (
                <div>
                  <h3 className="font-medium text-stone-700 mb-2">Entities</h3>
                  <div className="text-stone-600 space-y-2">
                    {finalResult.entities.people.length > 0 && (
                      <div>
                        <strong>People:</strong> {finalResult.entities.people.join(', ')}
                      </div>
                    )}
                    {finalResult.entities.places.length > 0 && (
                      <div>
                        <strong>Places:</strong> {finalResult.entities.places.join(', ')}
                      </div>
                    )}
                    {finalResult.entities.events.length > 0 && (
                      <div>
                        <strong>Events:</strong> {finalResult.entities.events.join(', ')}
                      </div>
                    )}
                    {finalResult.entities.organizations.length > 0 && (
                      <div>
                        <strong>Organizations:</strong> {finalResult.entities.organizations.join(', ')}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {finalResult.highlights && finalResult.highlights.length > 0 && (
                <div>
                  <h3 className="font-medium text-stone-700 mb-2">Highlights</h3>
                  <div className="space-y-1">
                    {finalResult.highlights.map((highlight: any, index: number) => (
                      <div key={index} className="text-stone-600">
                        <span className="font-medium">{highlight.type}:</span> "{highlight.text}"
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {finalResult.tokenUsage && (
                <div>
                  <h3 className="font-medium text-stone-700 mb-2">Token Usage</h3>
                  <div className="text-stone-600 text-sm space-y-1">
                    <div>Prompt: {finalResult.tokenUsage.promptTokens}</div>
                    {finalResult.tokenUsage.cachedTokens !== undefined && (
                      <div>Cached: {finalResult.tokenUsage.cachedTokens}</div>
                    )}
                    <div>Completion: {finalResult.tokenUsage.completionTokens}</div>
                    <div>Total: {finalResult.tokenUsage.totalTokens}</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Instructions */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
          <h2 className="text-lg font-medium text-blue-900 mb-3">How to Test</h2>
          <div className="text-blue-800 space-y-2">
            <p>1. Enter some journal text in the input field above</p>
            <p>2. Click "Start Streaming Test" to begin</p>
            <p>3. Watch as the reflection text appears character by character</p>
            <p>4. The final structured result will appear below once streaming completes</p>
            <p>5. Check the browser console for detailed progress logs</p>
          </div>
        </div>
      </div>

      {/* Back to main app link */}
      <div className="mt-12 text-center">
        <a
          href="/"
          className="text-emerald-600 hover:text-emerald-700 font-medium"
        >
          ← Back to Journal App
        </a>
      </div>
    </div>
  );
}
