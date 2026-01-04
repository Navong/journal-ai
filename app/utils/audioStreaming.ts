// utils/audioStreaming.ts
// Progressive audio streaming utility for Serenity Journal

export interface ProgressiveAudioOptions {
  bufferThreshold?: number; // Bytes to buffer before starting playback (default: 2MB)
  sampleRate?: number; // Audio sample rate (default: 44100)
}

export interface ProgressiveAudioPlayer {
  play: (audioStream: ReadableStream<Uint8Array>) => Promise<void>;
  stop: () => void;
  pause: () => void;
  resume: () => Promise<void>;
  isPlaying: () => boolean;
  isPaused: () => boolean;
}

/**
 * Creates a progressive audio player that can start playback while streaming
 */
export async function createProgressiveAudioPlayer(options: ProgressiveAudioOptions = {}): Promise<ProgressiveAudioPlayer> {
  const {
    bufferThreshold = 2048 * 1024, // 2MB buffer (~10-12 seconds of audio) - larger buffer for slower network/API
    sampleRate = 44100,
  } = options;

  let audioContext: AudioContext | null = null;
  let currentSource: AudioBufferSourceNode | null = null;
  let currentGainNode: GainNode | null = null;
  let isCurrentlyPlaying = false;
  let isCurrentlyPaused = false;
  let playbackStartTime: number | null = null;
  let partialDuration = 0;
  let partialEndedPromise: Promise<void> | null = null;
  let streamReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let isStopped = false;

  // Initialize audio context
  const initAudioContext = async (): Promise<AudioContext> => {
    if (!audioContext) {
      audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate });
    }

    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }

    return audioContext;
  };

  // Clean up current audio source
  const cleanupCurrentSource = () => {
    if (currentSource) {
      try {
        currentSource.onended = null;
        currentSource.disconnect();
        currentSource.stop();
      } catch (e) {
        // Source may already be stopped
      }
      currentSource = null;
    }

    if (currentGainNode) {
      currentGainNode.disconnect();
      currentGainNode = null;
    }
  };

  // Decode and play partial audio
  const playPartialAudio = async (partialBuffer: Uint8Array): Promise<number> => {
    const context = await initAudioContext();

    // Create audio buffer from partial data
    const audioBuffer = await context.decodeAudioData(partialBuffer.buffer.slice(0) as ArrayBuffer);
    partialDuration = audioBuffer.duration;

    // Create audio source and connect to output
    cleanupCurrentSource();
    currentSource = context.createBufferSource();
    currentGainNode = context.createGain();

    currentSource.buffer = audioBuffer;
    currentSource.connect(currentGainNode);
    currentGainNode.connect(context.destination);

    // Set up promise to resolve when partial playback ends
    partialEndedPromise = new Promise<void>((resolve) => {
      currentSource!.onended = () => {
        isCurrentlyPlaying = false;
        isCurrentlyPaused = false;
        resolve();
      };
    });

    // Start playback
    currentSource.start(0);
    isCurrentlyPlaying = true;
    isCurrentlyPaused = false;
    playbackStartTime = Date.now();

    return partialDuration;
  };

  // Play remaining audio from where partial left off
  const playRemainingAudio = async (completeBuffer: Uint8Array, skipTo: number = 0): Promise<void> => {
    const context = await initAudioContext();

    // Create complete audio buffer
    const audioBuffer = await context.decodeAudioData(completeBuffer.buffer.slice(0) as ArrayBuffer);

    // Create new source for complete audio
    cleanupCurrentSource();
    currentSource = context.createBufferSource();
    currentGainNode = context.createGain();

    currentSource.buffer = audioBuffer;
    currentSource.connect(currentGainNode);
    currentGainNode.connect(context.destination);

    // Set up promise to resolve when playback ends
    const playbackEndedPromise = new Promise<void>((resolve) => {
      currentSource!.onended = () => {
        isCurrentlyPlaying = false;
        isCurrentlyPaused = false;
        console.log(`[ProgressivePlayer] ✅ Playback fully completed`);
        resolve();
      };
    });

    // Start from specified position
    currentSource.start(0, skipTo);
    isCurrentlyPlaying = true;
    isCurrentlyPaused = false;
    playbackStartTime = Date.now();

    // Wait for playback to complete
    await playbackEndedPromise;
  };

  return {
    play: async (audioStream: ReadableStream<Uint8Array>) => {
      if (!audioStream) {
        throw new Error('Audio stream is required');
      }

      // Reset stop flag for new playback
      isStopped = false;

      const streamStartTime = Date.now();
      console.log('[ProgressivePlayer] Starting to consume audio stream...');

      const reader = audioStream.getReader();
      streamReader = reader;
      if (!reader) {
        throw new Error('No stream reader available');
      }

      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      let chunkCount = 0;
      let earlyPlaybackStarted = false;
      let firstPlaybackAttempt = false;
      let firstChunkTime: number | null = null;
      const MIN_BUFFER_FOR_PLAYBACK = bufferThreshold; // Use configurable threshold

      try {
        while (true) {
          // Check if stopped before reading
          if (isStopped) {
            console.log('[ProgressivePlayer] Playback stopped, cancelling stream...');
            try {
              reader.cancel();
            } catch (e) {
              // Reader may already be cancelled
            }
            break;
          }

          const { done, value } = await reader.read();

          if (done) {
            const totalTime = Date.now() - streamStartTime;
            console.log(`[ProgressivePlayer] Stream complete: ${chunkCount} chunks, ${(totalBytes / 1024).toFixed(0)}KB in ${totalTime}ms`);
            break;
          }

          // Check again after reading (stop might have been called during read)
          if (isStopped) {
            console.log('[ProgressivePlayer] Playback stopped after read, cancelling stream...');
            try {
              reader.cancel();
            } catch (e) {
              // Reader may already be cancelled
            }
            break;
          }

          if (value) {
            if (firstChunkTime === null) {
              firstChunkTime = Date.now();
              console.log(`[ProgressivePlayer] First chunk received in ${firstChunkTime - streamStartTime}ms (${value.length} bytes)`);
            }

            chunks.push(value);
            totalBytes += value.length;
            chunkCount++;

            // Log progress periodically
            if (chunkCount <= 5 || chunkCount % 50 === 0) {
              const elapsed = Date.now() - streamStartTime;
              console.log(`[ProgressivePlayer] Chunk ${chunkCount}: ${(totalBytes / 1024).toFixed(0)}KB total, ${elapsed}ms elapsed`);
            }

            // Attempt early playback once we have enough data
            if (!firstPlaybackAttempt && totalBytes >= MIN_BUFFER_FOR_PLAYBACK) {
              firstPlaybackAttempt = true;
              const bufferTime = Date.now() - streamStartTime;
              console.log(`[ProgressivePlayer] ✅ Buffered ${(totalBytes / 1024).toFixed(0)}KB in ${bufferTime}ms - attempting early playback...`);

              try {
                // Combine what we have so far
                const partialLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
                const partialBuffer = new Uint8Array(partialLength);
                let offset = 0;
                for (const chunk of chunks) {
                  partialBuffer.set(chunk, offset);
                  offset += chunk.length;
                }

                // Play partial audio
                const playbackStartTime = Date.now();
                await playPartialAudio(partialBuffer);
                const playTime = Date.now() - streamStartTime;
                console.log(`[ProgressivePlayer] 🎵 PLAYBACK STARTED in ${playTime}ms from stream start (decode took ${Date.now() - playbackStartTime}ms)`);
                earlyPlaybackStarted = true;
              } catch (error) {
                console.warn('[ProgressivePlayer] ⚠️ Early playback failed, will play complete audio when stream finishes:', error);
              }
            }
          }
        }

        // Combine all chunks for complete audio
        const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
        const completeBuffer = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
          completeBuffer.set(chunk, offset);
          offset += chunk.length;
        }

        // If early playback happened, prepare continuation audio while partial plays
        if (earlyPlaybackStarted && partialEndedPromise && !isStopped) {
          console.log(`[ProgressivePlayer] Stream complete, preparing continuation audio while partial plays...`);

          // Decode the complete audio NOW (while partial is still playing) to avoid gap
          const decodeStartTime = Date.now();
          const context = await initAudioContext();
          const completeAudioBuffer = await context.decodeAudioData(completeBuffer.buffer.slice(0) as ArrayBuffer);
          const decodeTime = Date.now() - decodeStartTime;
          console.log(`[ProgressivePlayer] Continuation decoded in ${decodeTime}ms (${completeAudioBuffer.duration.toFixed(2)}s total audio)`);

          // Check if stopped before continuing
          if (isStopped) {
            console.log('[ProgressivePlayer] Playback stopped, skipping continuation');
            cleanupCurrentSource();
          } else {
            // Now wait for partial to finish
            console.log(`[ProgressivePlayer] Waiting for partial playback to end...`);
            await partialEndedPromise;

            // Check again after waiting
            if (isStopped) {
              console.log('[ProgressivePlayer] Playback stopped during partial wait, skipping continuation');
              cleanupCurrentSource();
            } else {
              console.log(`[ProgressivePlayer] Partial ended, starting continuation immediately from ${partialDuration.toFixed(2)}s...`);

              // Create and play continuation source immediately (audio already decoded!)
              cleanupCurrentSource();
              currentSource = context.createBufferSource();
              currentGainNode = context.createGain();

              currentSource.buffer = completeAudioBuffer;
              currentSource.connect(currentGainNode);
              currentGainNode.connect(context.destination);

              // Set up promise to resolve when continuation playback ends
              const continuationEndedPromise = new Promise<void>((resolve) => {
                currentSource!.onended = () => {
                  isCurrentlyPlaying = false;
                  isCurrentlyPaused = false;
                  console.log(`[ProgressivePlayer] ✅ Playback fully completed`);
                  resolve();
                };
              });

              // Start from where partial left off
              currentSource.start(0, partialDuration);
              isCurrentlyPlaying = true;
              isCurrentlyPaused = false;
              playbackStartTime = Date.now();

              console.log(`[ProgressivePlayer] ▶️ Continuation playing (${(completeAudioBuffer.duration - partialDuration).toFixed(2)}s remaining)`);

              // Wait for continuation playback to complete
              await continuationEndedPromise;
            }
          }
        } else if (!isStopped) {
          // Play complete audio from beginning (only if not stopped)
          await playRemainingAudio(completeBuffer);
        } else {
          console.log('[ProgressivePlayer] Playback stopped, skipping complete audio playback');
          cleanupCurrentSource();
        }
      } finally {
        try {
          reader.releaseLock();
        } catch (e) {
          // Lock may already be released
        }
        streamReader = null;
      }
    },

    stop: () => {
      console.log('[ProgressivePlayer] Stop called');
      isStopped = true;
      cleanupCurrentSource();
      isCurrentlyPlaying = false;
      isCurrentlyPaused = false;
      playbackStartTime = null;

      // Cancel stream reader if active
      if (streamReader) {
        try {
          streamReader.cancel();
          console.log('[ProgressivePlayer] Stream reader cancelled');
        } catch (e) {
          // Reader may already be cancelled or released
        }
        streamReader = null;
      }
    },

    pause: () => {
      if (audioContext && audioContext.state === 'running') {
        audioContext.suspend();
        isCurrentlyPaused = true;
      }
    },

    resume: async () => {
      if (audioContext && audioContext.state === 'suspended') {
        await audioContext.resume();
        isCurrentlyPaused = false;
      }
    },

    isPlaying: () => isCurrentlyPlaying,
    isPaused: () => isCurrentlyPaused,
  };
}

/**
 * Fetch and play audio stream progressively
 */
export async function playProgressiveAudioFromUrl(url: string, options: ProgressiveAudioOptions = {}): Promise<void> {
  const response = await fetch(url);

  if (!response.ok || !response.body) {
    throw new Error(`Failed to fetch audio: ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get('Content-Type');
  if (!contentType || !contentType.includes('audio/')) {
    throw new Error(`Invalid content type: ${contentType}`);
  }

  const player = await createProgressiveAudioPlayer(options);
  await player.play(response.body);
}