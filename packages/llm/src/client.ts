import { randomUUID } from 'node:crypto';
import { cacheKey, readCache, writeCache } from './cache.ts';
import { costUsd, loadSnapshot } from './pricing.ts';
import type { ChatMessage, ChatRequest, ChatResult, PriceTable } from './types.ts';

export const OPENCODE_BASE_URL = 'https://opencode.ai/inference/go/openai/v1';
const MAX_ATTEMPTS = 3;
/** Rate limits are transient by design, so 429 gets more patience than server errors. */
const MAX_ATTEMPTS_429 = 8;
const MAX_BACKOFF_MS = 60_000;
const USER_AGENT = 'agent-engineering-cases/0.1';

export interface LlmOptions {
  cacheDir?: string;
  sessionId?: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  /** Defaults to the committed price snapshot. */
  prices?: PriceTable;
  /** Base delay for exponential backoff between retries. */
  retryDelayMs?: number;
  /** Injected for tests. */
  sleep?: (ms: number) => Promise<void>;
}

export class LlmHttpError extends Error {
  constructor(readonly status: number, body: string, readonly retryAfterMs?: number) {
    super(`LLM HTTP ${status}: ${body.slice(0, 500)}`);
  }
}

const retryable = (status: number) => status === 429 || status >= 500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createLlm(opts: LlmOptions = {}) {
  const cacheDir = opts.cacheDir ?? process.env.LLM_CACHE_DIR ?? '.cache/llm';
  const sessionId = opts.sessionId ?? randomUUID();
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? (() => new Date());
  const retryDelayMs = opts.retryDelayMs ?? 1000;
  const wait = opts.sleep ?? sleep;
  let pricesP: Promise<PriceTable> | undefined = opts.prices ? Promise.resolve(opts.prices) : undefined;
  const stats = { calls: 0, cachedCalls: 0, costUsd: 0 };

  function endpoint(req: ChatRequest): { url: string; headers: Record<string, string> } {
    const headers: Record<string, string> = { 'content-type': 'application/json', 'user-agent': USER_AGENT };
    if (req.provider === 'opencode') {
      const key = process.env.OPENCODE_API_KEY;
      if (!key) throw new Error('OPENCODE_API_KEY is not set');
      headers.authorization = `Bearer ${key}`;
      headers['x-opencode-session'] = sessionId;
      return { url: `${OPENCODE_BASE_URL}/chat/completions`, headers };
    }
    const base = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434/v1';
    return { url: `${base.replace(/\/$/, '')}/chat/completions`, headers };
  }

  function body(req: ChatRequest): string {
    return JSON.stringify({
      model: req.model,
      messages: req.messages,
      tools: req.tools,
      temperature: req.temperature,
      max_tokens: req.maxTokens,
      response_format: req.responseFormat,
    });
  }

  async function post(req: ChatRequest): Promise<{ json: any; latencyMs: number }> {
    const { url, headers } = endpoint(req);
    let lastError: unknown;
    for (let attempt = 1; ; attempt++) {
      const started = performance.now();
      let retryAfterMs: number | undefined;
      let limit = MAX_ATTEMPTS;
      try {
        const res = await fetchImpl(url, { method: 'POST', headers, body: body(req) });
        if (res.ok) return { json: await res.json(), latencyMs: Math.round(performance.now() - started) };
        const ra = Number(res.headers.get('retry-after'));
        retryAfterMs = Number.isFinite(ra) && ra > 0 ? ra * 1000 : undefined;
        const err = new LlmHttpError(res.status, await res.text(), retryAfterMs);
        if (!retryable(res.status)) throw err;
        if (res.status === 429) limit = MAX_ATTEMPTS_429;
        lastError = err;
      } catch (e) {
        if (e instanceof LlmHttpError && !retryable(e.status)) throw e;
        if (!(e instanceof LlmHttpError)) lastError = e;
      }
      if (attempt >= limit) throw lastError;
      await wait(retryAfterMs ?? Math.min(MAX_BACKOFF_MS, retryDelayMs * 2 ** (attempt - 1)));
    }
  }

  async function chat(req: ChatRequest): Promise<ChatResult> {
    stats.calls++;
    const key = cacheKey(req);
    const hit = await readCache(cacheDir, key);
    if (hit) {
      stats.cachedCalls++;
      return hit;
    }
    const { json, latencyMs } = await post(req);
    const message = json?.choices?.[0]?.message as ChatMessage | undefined;
    if (!message) throw new Error(`LLM response without choices[0].message: ${JSON.stringify(json).slice(0, 300)}`);
    const usage = {
      inputTokens: json.usage?.prompt_tokens ?? 0,
      cachedInputTokens: json.usage?.prompt_tokens_details?.cached_tokens ?? 0,
      outputTokens: json.usage?.completion_tokens ?? 0,
    };
    pricesP ??= loadSnapshot();
    const cost = costUsd(req.model, usage, now(), await pricesP);
    const result: ChatResult = { message, usage, costUsd: cost, latencyMs, cached: false, model: json.model ?? req.model };
    await writeCache(cacheDir, key, result);
    stats.costUsd += cost;
    return result;
  }

  return { chat, totals: () => ({ ...stats }) };
}
