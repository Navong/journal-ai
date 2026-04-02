import logger from './logger';

const log = logger.module('GeminiRetry');

export async function withGeminiRetry<T>(fn: () => Promise<T>): Promise<T> {
  const maxAttempts = 3;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastErr = err;
      const e = err as { code?: number; status?: number; statusCode?: number; message?: string; response?: { status?: number } };
      const code = e?.code ?? e?.status ?? e?.statusCode;
      const status = e?.status ?? e?.response?.status;
      const message = `${e?.message || ''}`.toLowerCase();
      const isUnavailable =
        code === 503 ||
        status === 503 ||
        message.includes('unavailable') ||
        message.includes('high demand');

      if (!isUnavailable || attempt === maxAttempts) throw err;

      const backoffMs = 400 * Math.pow(2, attempt - 1);
      log.warn('Gemini overloaded (503). Retrying...', { attempt, backoffMs });
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Gemini request failed');
}
