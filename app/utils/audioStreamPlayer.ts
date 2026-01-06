// app/utils/audioStreamPlayer.ts
// Unified audio streaming player for all TTS providers

export type AudioFormat = 'pcm' | 'wav' | 'mp3';

export interface AudioStreamPlayerOptions {
  format: AudioFormat;
  sampleRate?: number; // Required for PCM, optional for others (defaults to AudioContext default)
  onLog?: (message: string) => void;
  onProgress?: (bytesReceived: number, totalBytes?: number) => void;
  onStatusChange?: (status: string) => void;
  segmentSize?: number; // Size in bytes for progressive playback segments (default: 512KB for faster playback)
  maxSegments?: number; // Maximum number of segments for progressive playback (default: 10)
}

export class AudioStreamPlayer {
  private audioContext: AudioContext | null = null;
  private currentSource: AudioBufferSourceNode | null = null;
  private options: Required<AudioStreamPlayerOptions>;
  private isPlaying: boolean = false;
  private requestStartTime: number = 0;

  constructor(options: AudioStreamPlayerOptions) {
    this.options = {
      format: options.format,
      sampleRate: options.sampleRate || 44100,
      onLog: options.onLog || (() => {}),
      onProgress: options.onProgress || (() => {}),
      onStatusChange: options.onStatusChange || (() => {}),
      segmentSize: options.segmentSize || 256 * 1024, // 512KB default for faster playback
      maxSegments: options.maxSegments || 10,
    };
  }

  /**
   * Convert raw PCM bytes to AudioBuffer for Web Audio API
   * PCM format: 16-bit signed integers, little-endian, mono
   */
  private pcmToAudioBuffer(pcmData: Uint8Array, channels: number = 1): AudioBuffer {
    if (!this.audioContext) {
      throw new Error('AudioContext not initialized');
    }

    // PCM is 16-bit (2 bytes per sample)
    const numSamples = Math.floor(pcmData.length / 2);
    const audioBuffer = this.audioContext.createBuffer(
      channels,
      numSamples,
      this.options.sampleRate
    );

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
  }

  /**
   * Convert PCM to WAV format by adding WAV headers
   */
  private pcmToWav(pcmData: Uint8Array, channels: number = 1): Uint8Array {
    // Validate input
    if (pcmData.length === 0) {
      throw new Error('PCM data is empty');
    }

    // Ensure data length is even (16-bit samples = 2 bytes per sample)
    const dataSize = pcmData.length % 2 === 0 ? pcmData.length : pcmData.length - 1;
    if (dataSize !== pcmData.length) {
      this.options.onLog(`[WAV] PCM data length ${pcmData.length} is odd, using ${dataSize} bytes`);
    }

    const bytesPerSample = 2; // 16-bit = 2 bytes
    const blockAlign = channels * bytesPerSample;
    const byteRate = this.options.sampleRate * blockAlign;
    const totalFileSize = 44 + dataSize; // 44 bytes header + data
    const riffChunkSize = totalFileSize - 8;

    // Create WAV header buffer
    const header = new ArrayBuffer(44);
    const view = new DataView(header);

    // RIFF chunk descriptor
    view.setUint32(0, 0x46464952, true); // "RIFF"
    view.setUint32(4, riffChunkSize, true);
    view.setUint32(8, 0x45564157, true); // "WAVE"

    // fmt sub-chunk
    view.setUint32(12, 0x20746d66, true); // "fmt "
    view.setUint32(16, 16, true); // Sub-chunk size (16 for PCM)
    view.setUint16(20, 1, true); // Audio format (1 = PCM)
    view.setUint16(22, channels, true);
    view.setUint32(24, this.options.sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true); // Bits per sample

    // data sub-chunk
    view.setUint32(36, 0x61746164, true); // "data"
    view.setUint32(40, dataSize, true);

    // Combine header and PCM data
    const wavFile = new Uint8Array(44 + dataSize);
    wavFile.set(new Uint8Array(header), 0);
    wavFile.set(pcmData.slice(0, dataSize), 44);

    return wavFile;
  }

  /**
   * Initialize AudioContext
   */
  private async initAudioContext(): Promise<void> {
    if (!this.audioContext) {
      this.audioContext = new AudioContext({ sampleRate: this.options.sampleRate });
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }
      this.options.onLog(
        `AudioContext created (state: ${this.audioContext.state}, sampleRate: ${this.audioContext.sampleRate}Hz)`
      );
    }
  }

  /**
   * Stream and play audio from a Response object
   */
  async playFromResponse(response: Response): Promise<void> {
    this.requestStartTime = Date.now();
    this.isPlaying = true;

    try {
      this.options.onStatusChange('Reading stream...');
      this.options.onLog('📥 Reading chunks from stream...');

      // Read stream and collect chunks
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body reader available');
      }

      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      let chunkCount = 0;
      let firstChunkTime: number | null = null;
      const streamStartTime = Date.now();

      // Progressive playback state
      let segmentIndex = 0;
      let segmentDurations: number[] = [];
      let lastPlaybackPromise: Promise<void> | null = null;
      let segmentProcessingPromise: Promise<void> = Promise.resolve();

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          this.options.onLog('✅ All chunks received');
          break;
        }

        if (value) {
          if (firstChunkTime === null) {
            firstChunkTime = Date.now();
            const timeToFirstChunk = firstChunkTime - this.requestStartTime;
            this.options.onLog(
              `⚡ First chunk received: ${timeToFirstChunk}ms (size: ${value.length} bytes)`
            );
          }

          chunks.push(value);
          totalBytes += value.length;
          chunkCount++;
          this.options.onProgress(totalBytes);

          // Log progress
          if (chunkCount <= 5 || chunkCount % 50 === 0) {
            const elapsed = Date.now() - streamStartTime;
            const rate = (totalBytes / 1024) / (elapsed / 1000);
            this.options.onLog(
              `📦 Chunk ${chunkCount}: ${value.length} bytes, total: ${(totalBytes / 1024).toFixed(
                1
              )}KB, rate: ${rate.toFixed(2)}KB/s`
            );
          }

          // Progressive playback: Play segments as they're buffered
          const currentSegmentThreshold = (segmentIndex + 1) * this.options.segmentSize;
          if (segmentIndex < this.options.maxSegments && totalBytes >= currentSegmentThreshold) {
            const segmentNum = segmentIndex + 1;
            segmentIndex++;

            const bufferTime = Date.now() - streamStartTime;
            this.options.onLog(
              `✅ Segment ${segmentNum} ready: ${(totalBytes / 1024).toFixed(
                1
              )}KB buffered in ${bufferTime}ms`
            );

            // Process segment sequentially
            segmentProcessingPromise = segmentProcessingPromise.then(async () => {
              try {
                await this.initAudioContext();

                // Calculate segment boundaries
                const segmentZeroBasedIndex = segmentNum - 1;
                const segmentStartByte = segmentZeroBasedIndex * this.options.segmentSize;
                const segmentEndByte = Math.min(totalBytes, segmentNum * this.options.segmentSize);

                // Combine all chunks into a single buffer
                const allChunksLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
                const allChunksBuffer = new Uint8Array(allChunksLength);
                let offset = 0;
                for (const chunk of chunks) {
                  allChunksBuffer.set(chunk, offset);
                  offset += chunk.length;
                }

                // Extract segment
                const segmentBuffer = allChunksBuffer.slice(segmentStartByte, segmentEndByte);

                // Decode segment based on format
                let audioBuffer: AudioBuffer;
                if (this.options.format === 'pcm') {
                  const convertStart = Date.now();
                  audioBuffer = this.pcmToAudioBuffer(segmentBuffer, 1);
                  const convertTime = Date.now() - convertStart;
                  this.options.onLog(
                    `✅ Segment ${segmentNum} PCM converted in ${convertTime}ms (duration: ${audioBuffer.duration.toFixed(
                      2
                    )}s)`
                  );
                } else if (this.options.format === 'wav') {
                  // WAV format: Extract PCM data and convert manually
                  // Only the first segment has the WAV header (44 bytes)
                  // Subsequent segments are raw PCM data without headers
                  const convertStart = Date.now();

                  // For segment 1, skip the WAV header (44 bytes)
                  // For subsequent segments, the entire buffer is PCM data
                  const pcmData = segmentNum === 1
                    ? segmentBuffer.slice(44)
                    : segmentBuffer;

                  audioBuffer = this.pcmToAudioBuffer(pcmData, 1);
                  const convertTime = Date.now() - convertStart;
                  this.options.onLog(
                    `✅ Segment ${segmentNum} WAV converted from ${segmentNum === 1 ? 'WAV header + PCM' : 'raw PCM'} in ${convertTime}ms (duration: ${audioBuffer.duration.toFixed(
                      2
                    )}s)`
                  );
                } else {
                  // MP3 format - try to decode segment
                  // NOTE: MP3 segments might fail if they don't start/end at frame boundaries
                  // We'll try to decode, but fall back gracefully if it fails
                  try {
                    audioBuffer = await this.audioContext!.decodeAudioData(
                      segmentBuffer.buffer.slice(0)
                    );
                    this.options.onLog(
                      `✅ Segment ${segmentNum} MP3 decoded (duration: ${audioBuffer.duration.toFixed(2)}s)`
                    );
                  } catch (decodeError: any) {
                    // MP3 segment decoding failed - likely cut at non-frame boundary
                    // Skip this segment and let the complete audio play instead
                    this.options.onLog(
                      `⚠️ Segment ${segmentNum} MP3 decode failed (${decodeError.message}), skipping to complete audio`
                    );
                    return; // Exit this segment processing, don't add to playback chain
                  }
                }

                segmentDurations.push(audioBuffer.duration);

                // Play segment
                const playSegment = async () => {
                  return new Promise<void>((resolve) => {
                    const source = this.audioContext!.createBufferSource();
                    source.buffer = audioBuffer;
                    source.connect(this.audioContext!.destination);

                    if (segmentNum === 1) {
                      const playTime = Date.now() - this.requestStartTime;
                      this.options.onLog(`🎵 Segment ${segmentNum} PLAYBACK STARTED in ${playTime}ms`);
                      this.options.onStatusChange(`Playing segment ${segmentNum}...`);
                    } else {
                      this.options.onLog(
                        `🎵 Segment ${segmentNum} PLAYBACK STARTED (chained after segment ${
                          segmentNum - 1
                        })`
                      );
                      this.options.onStatusChange(`Playing segment ${segmentNum}...`);
                    }

                    source.onended = () => {
                      this.options.onLog(
                        `✅ Segment ${segmentNum} ended (${audioBuffer.duration.toFixed(2)}s)`
                      );
                      resolve();
                    };

                    source.start(0);
                  });
                };

                // Chain after previous segment
                if (lastPlaybackPromise) {
                  await lastPlaybackPromise;
                }
                lastPlaybackPromise = playSegment();
              } catch (error: any) {
                this.options.onLog(`⚠️ Segment ${segmentNum} failed: ${error.message}`);
              }
            });
          }

          // Yield to event loop
          if (chunkCount % 10 === 0) {
            await Promise.resolve();
          }
        }
      }

      // Stream complete - combine all chunks
      const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const completeBuffer = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        completeBuffer.set(chunk, offset);
        offset += chunk.length;
      }

      this.options.onLog(`Combined ${(totalLength / 1024).toFixed(1)}KB data`);

      // Initialize audio context if needed
      await this.initAudioContext();

      // Decode complete audio
      this.options.onStatusChange('Decoding complete audio...');
      const decodeStart = Date.now();
      let completeAudioBuffer: AudioBuffer;

      if (this.options.format === 'pcm') {
        completeAudioBuffer = this.pcmToAudioBuffer(completeBuffer, 1);
      } else if (this.options.format === 'wav') {
        // WAV format: Extract PCM data (skip 44-byte header) and convert manually
        // This is more reliable than decodeAudioData for streamed WAV where header size may not match
        const pcmData = completeBuffer.slice(44);
        completeAudioBuffer = this.pcmToAudioBuffer(pcmData, 1);
      } else {
        // MP3 format - use decodeAudioData
        completeAudioBuffer = await this.audioContext!.decodeAudioData(completeBuffer.buffer.slice(0));
      }

      const decodeTime = Date.now() - decodeStart;
      this.options.onLog(
        `🔊 Complete audio decoded in ${decodeTime}ms (duration: ${completeAudioBuffer.duration.toFixed(
          2
        )}s)`
      );

      // Play complete audio
      const source = this.audioContext!.createBufferSource();
      source.buffer = completeAudioBuffer;
      source.connect(this.audioContext!.destination);

      source.onended = () => {
        const totalTime = Date.now() - this.requestStartTime;
        this.options.onLog(`🏁 Playback ended. Total time: ${totalTime}ms`);
        this.options.onStatusChange('Playback complete');
        this.isPlaying = false;
      };

      // Wait for segments to finish if any
      if (segmentIndex > 0) {
        this.options.onLog(`Waiting for ${segmentIndex} segment(s) to finish...`);
        await segmentProcessingPromise;
        if (lastPlaybackPromise) {
          await lastPlaybackPromise; // Wait for last segment to finish before playing remaining audio
        }

        // Play remaining audio from where segments left off
        const totalSegmentDuration = segmentDurations.reduce((sum, d) => sum + d, 0);
        this.options.onLog(
          `▶️ Playing remaining audio from ${totalSegmentDuration.toFixed(2)}s...`
        );
        this.options.onStatusChange('Playing remaining audio...');
        source.start(0, totalSegmentDuration);
      } else {
        // Play from beginning
        const playTime = Date.now() - this.requestStartTime;
        this.options.onLog(`🎵 PLAYBACK STARTED in ${playTime}ms`);
        this.options.onStatusChange('Playing audio...');
        source.start(0);
      }

      this.currentSource = source;
    } catch (error: any) {
      this.options.onLog(`❌ ERROR: ${error.message}`);
      this.options.onStatusChange(`Error: ${error.message}`);
      this.isPlaying = false;
      throw error;
    }
  }

  /**
   * Stop playback
   */
  stop(): void {
    if (this.currentSource) {
      try {
        this.currentSource.stop();
        this.currentSource.disconnect();
        this.options.onLog('Audio stopped by user');
      } catch (e) {
        // Already stopped
      }
      this.currentSource = null;
    }
    this.isPlaying = false;
    this.options.onStatusChange('Stopped');
  }

  /**
   * Get current playback state
   */
  getIsPlaying(): boolean {
    return this.isPlaying;
  }

  /**
   * Clean up resources
   */
  async dispose(): Promise<void> {
    this.stop();
    if (this.audioContext) {
      await this.audioContext.close();
      this.audioContext = null;
    }
  }
}
