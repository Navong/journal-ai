// Audio optimization utility
// Compresses audio using Web Audio API and MediaRecorder for cross-device sync

interface AudioOptimizationOptions {
  bitrate?: number; // Bitrate in kbps (default: 64 for speech)
  format?: 'mp3' | 'aac' | 'webm'; // Audio format (default: webm, fallback to available)
}

/**
 * Compresses audio from base64 PCM data to optimized format
 * @param audioBase64 - Base64 encoded PCM audio data
 * @param options - Optimization options
 * @returns Compressed audio as base64 string
 */
export async function optimizeAudio(
  audioBase64: string,
  options: AudioOptimizationOptions = {}
): Promise<string> {
  const { bitrate = 64, format = 'webm' } = options;

  try {
    // Decode base64 to ArrayBuffer
    const binaryString = atob(audioBase64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // Convert PCM to AudioBuffer
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
      sampleRate: 24000,
    });

    // Decode PCM data (assuming 16-bit PCM, mono, 24kHz)
    const dataInt16 = new Int16Array(bytes.buffer);
    const frameCount = dataInt16.length;
    const buffer = audioContext.createBuffer(1, frameCount, 24000);
    const channelData = buffer.getChannelData(0);

    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i] / 32768.0;
    }

    // Compress using MediaRecorder
    const compressedAudio = await compressAudioBuffer(buffer, audioContext, bitrate, format);

    // Clean up
    audioContext.close();

    return compressedAudio;
  } catch (error) {
    console.error('Audio optimization error:', error);
    // Return original if optimization fails
    return audioBase64;
  }
}

/**
 * Compresses AudioBuffer to specified format using MediaRecorder
 */
async function compressAudioBuffer(
  audioBuffer: AudioBuffer,
  audioContext: AudioContext,
  bitrate: number,
  format: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      // Create MediaStreamDestination
      const destination = audioContext.createMediaStreamDestination();

      // Create source from AudioBuffer
      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(destination);
      source.start(0);

      // Determine MIME type based on browser support
      let mimeType = 'audio/webm';
      if (format === 'mp3' && MediaRecorder.isTypeSupported('audio/mpeg')) {
        mimeType = 'audio/mpeg';
      } else if (format === 'aac' && MediaRecorder.isTypeSupported('audio/aac')) {
        mimeType = 'audio/aac';
      } else if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
        mimeType = 'audio/webm;codecs=opus';
      } else if (MediaRecorder.isTypeSupported('audio/webm')) {
        mimeType = 'audio/webm';
      } else {
        // Fallback to any supported format
        const supportedTypes = [
          'audio/webm;codecs=opus',
          'audio/webm',
          'audio/mp4',
          'audio/ogg;codecs=opus',
        ];
        mimeType = supportedTypes.find(type => MediaRecorder.isTypeSupported(type)) || 'audio/webm';
      }

      // Create MediaRecorder with bitrate
      const mediaRecorder = new MediaRecorder(destination.stream, {
        mimeType,
        audioBitsPerSecond: bitrate * 1000, // Convert kbps to bps
      });

      const chunks: Blob[] = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunks, { type: mimeType });
        const reader = new FileReader();

        reader.onloadend = () => {
          const base64 = (reader.result as string).split(',')[1]; // Remove data:audio/...;base64, prefix
          resolve(base64);
        };

        reader.onerror = () => {
          reject(new Error('Failed to read compressed audio'));
        };

        reader.readAsDataURL(blob);
      };

      mediaRecorder.onerror = (event) => {
        reject(new Error('MediaRecorder error'));
      };

      // Start recording
      mediaRecorder.start();

      // Stop after audio buffer duration
      const duration = audioBuffer.duration * 1000; // Convert to ms
      setTimeout(() => {
        if (mediaRecorder.state !== 'inactive') {
          mediaRecorder.stop();
          source.stop();
        }
      }, duration + 100); // Add small buffer
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Estimates the size reduction from optimization
 * @param originalSize - Original base64 string length
 * @returns Estimated compressed size (conservative estimate: 70% reduction)
 */
export function estimateCompressionRatio(originalSize: number): number {
  // Base64 adds ~33% overhead, compression removes ~60-80%
  // Net: ~70% reduction for typical speech audio
  return Math.ceil(originalSize * 0.3);
}

