import Anthropic from "@anthropic-ai/sdk";

let _client: Anthropic | null = null;
export function getAnthropic(): Anthropic {
  if (!_client) {
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _client;
}

// Backwards compat: tests vi.mock this entire module and provide their own `anthropic`.
// Production code should call getAnthropic() — but the existing agents import `anthropic`,
// so re-export a Proxy that lazily delegates. This keeps callsites unchanged.
export const anthropic = new Proxy({} as Anthropic, {
  get(_target, prop) {
    return (getAnthropic() as unknown as Record<string | symbol, unknown>)[prop];
  },
});

export type RetryOptions = { maxRetries?: number; baseDelayMs?: number };

export async function callWithRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const maxRetries = opts.maxRetries ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 1000;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastErr = err;
      const status = (err as { status?: number })?.status;
      if (status !== 429) throw err;
      if (attempt === maxRetries) break;
      const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 100;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

export const MODELS = {
  HAIKU: "claude-haiku-4-5-20251001",
  SONNET: "claude-sonnet-4-6",
  OPUS: "claude-opus-4-7",
} as const;
