
// app/lib/llm/index.ts
import { LLMProvider } from './interface';
import { GeminiLLMProvider } from './providers/gemini';
import { GrokLLMProvider } from './providers/grok';

// Provider type definitions
export type LLMProviderType = 'gemini' | 'grok';

// Check if provider has required API keys available
export function isProviderAvailable(type: LLMProviderType): boolean {
  switch (type) {
    case 'gemini':
      return !!(process.env.NEXT_PUBLIC_GEMINI_API_KEY || process.env.GEMINI_API_KEY);
    case 'grok':
      return !!(process.env.NEXT_PUBLIC_OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY);
    default:
      return false;
  }
}

// Cache instances to avoid re-instantiation
const providerInstances: Partial<Record<LLMProviderType, LLMProvider>> = {};

export function getLLMProvider(type: LLMProviderType = 'gemini'): LLMProvider {
  // Check if provider is available before instantiating
  if (!isProviderAvailable(type)) {
    throw new Error(`${type.toUpperCase()}_API_KEY is not configured. Please set the required API key in your .env.local file`);
  }

  if (!providerInstances[type]) {
    switch (type) {
      case 'gemini':
        providerInstances[type] = new GeminiLLMProvider();
        break;
      case 'grok':
        providerInstances[type] = new GrokLLMProvider();
        break;
      default:
        throw new Error(`Unknown LLM provider type: ${type}`);
    }
  }
  return providerInstances[type]!;
}
