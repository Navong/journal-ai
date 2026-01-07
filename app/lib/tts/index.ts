
// app/services/providers/tts/index.ts
import { TTSProvider } from './interface';
import { CartesiaTTSProvider } from './cartesia';
import { MurfTTSProvider } from './murf';
import { ElevenLabsTTSProvider } from './elevenlabs';
import { FishAudioTTSProvider } from './fish';
import { GeminiTTSProvider } from './gemini';

// Support multiple TTS providers via environment variable
// Set TTS_PROVIDER=murf, TTS_PROVIDER=elevenlabs, TTS_PROVIDER=fish, TTS_PROVIDER=gemini, or TTS_PROVIDER=cartesia (default: cartesia)

declare const process: {
  env: {
    TTS_PROVIDER?: string;
  };
};

let ttsProviderInstance: TTSProvider | null = null;
let currentProviderType: string | null = null;

export function getTTSProvider(providerOverride?: string): TTSProvider {
  const providerType = (providerOverride || process.env.TTS_PROVIDER || 'cartesia').toLowerCase().trim();
  
  // Recreate provider if type changed (for testing/override support)
  if (!ttsProviderInstance || currentProviderType !== providerType) {
    if (providerType === 'murf') {
      ttsProviderInstance = new MurfTTSProvider();
    } else if (providerType === 'elevenlabs') {
      ttsProviderInstance = new ElevenLabsTTSProvider();
    } else if (providerType === 'fish') {
      ttsProviderInstance = new FishAudioTTSProvider();
    } else if (providerType === 'gemini') {
      ttsProviderInstance = new GeminiTTSProvider();
    } else {
      // Default to Cartesia for backward compatibility
      ttsProviderInstance = new CartesiaTTSProvider();
    }
    currentProviderType = providerType;
  }
  
  return ttsProviderInstance;
}
