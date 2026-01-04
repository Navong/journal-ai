
// app/services/providers/tts/index.ts
import { TTSProvider } from './interface';
import { CartesiaTTSProvider } from './cartesia';

// Similar to LLM, this could be extended to support multiple TTS providers.
// For now, Cartesia is the primary TTS.

let ttsProviderInstance: TTSProvider | null = null;

export function getTTSProvider(): TTSProvider {
  if (!ttsProviderInstance) {
    // Here, you could check an environment variable like process.env.TTS_PROVIDER_TYPE
    // and conditionally instantiate different providers.
    // For this project, Cartesia is the primary TTS.
    ttsProviderInstance = new CartesiaTTSProvider();
  }
  return ttsProviderInstance;
}
