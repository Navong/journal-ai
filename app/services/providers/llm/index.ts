
// app/services/providers/llm/index.ts
import { LLMProvider } from './interface';
import { GeminiLLMProvider } from './gemini';

// In a more complex scenario, this could read from an environment variable
// or a configuration file to determine which LLM provider to instantiate.
// For now, we'll default to Gemini.

let llmProviderInstance: LLMProvider | null = null;

export function getLLMProvider(): LLMProvider {
  if (!llmProviderInstance) {
    // Here, you could check an environment variable like process.env.LLM_PROVIDER_TYPE
    // and conditionally instantiate different providers (e.g., 'gemini', 'openai', etc.)
    // For this project, Gemini is the primary LLM.
    llmProviderInstance = new GeminiLLMProvider();
  }
  return llmProviderInstance;
}
