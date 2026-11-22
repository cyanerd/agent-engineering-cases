import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { createLlm } from '../src/client.ts';
import type { ChatRequest } from '../src/types.ts';

const KEY = 'test-key-not-a-secret-123456789';
type Call = { url: string; init: RequestInit };

function stubFetch(responses: Array<() => Response>) {
  const calls: Call[] = [];
  let i = 0;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    const r = responses[Math.min(i++, responses.length - 1)]!;
    return r();
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const ok = (message: object = { role: 'assistant', content: 'hi' }) => () =>
  new Response(
    JSON.stringify({
      model: 'deepseek-v4.1-flash',
      choices: [{ message }],
      usage: { prompt_tokens: 100, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 40 } },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );

const req: ChatRequest = { provider: 'opencode', model: 'deepseek-v4.1-flash', messages: [{ role: 'user', content: 'ping' }], temperature: 0 };
const prices = { 'deepseek-v4.1-flash': { input: 0.15, cachedInput: 0.003, output: 0.6 } };
let cacheDir: string;

beforeEach(() => {
  cacheDir = mkdtempSync(join(tmpdir(), 'llm-client-'));
  process.env.OPENCODE_API_KEY = KEY;
  process.env.OLLAMA_BASE_URL = 'http://localhost:11434/v1';
});

describe('createLlm', () => {
  it('posts to OpenCode Go with bearer key and session header', async () => {
    const { calls, fetchImpl } = stubFetch([ok()]);
    const llm = createLlm({ cacheDir, sessionId: 'sess-1', fetchImpl, prices, retryDelayMs: 0 });
    await llm.chat(req);
    expect(calls[0]!.url).toBe('https://opencode.ai/inference/go/openai/v1/chat/completions');
    const h = new Headers(calls[0]!.init.headers);
    expect(h.get('authorization')).toBe(`Bearer ${KEY}`);
    expect(h.get('x-opencode-session')).toBe('sess-1');
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({ model: 'deepseek-v4.1-flash', temperature: 0 });
  });

  it('posts to Ollama without authorization', async () => {
    const { calls, fetchImpl } = stubFetch([ok()]);
    const llm = createLlm({ cacheDir, fetchImpl, prices, retryDelayMs: 0 });
    await llm.chat({ ...req, provider: 'ollama', model: 'qwen3:8b' });
    expect(calls[0]!.url).toBe('http://localhost:11434/v1/chat/completions');
    expect(new Headers(calls[0]!.init.headers).get('authorization')).toBeNull();
  });

  it('sends reasoningEffort as reasoning_effort and keeps it in the cache key', async () => {
    const { calls, fetchImpl } = stubFetch([ok(), ok()]);
    const llm = createLlm({ cacheDir, fetchImpl, prices, retryDelayMs: 0 });
    const q = { ...req, provider: 'ollama' as const, model: 'qwen3:8b' };
    await llm.chat({ ...q, reasoningEffort: 'none' });
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({ reasoning_effort: 'none' });
    await llm.chat(q);
    expect(calls).toHaveLength(2);
    expect(JSON.parse(String(calls[1]!.init.body))).not.toHaveProperty('reasoning_effort');
  });

  it('maps usage, computes cost, second identical call is served from cache', async () => {
    const { calls, fetchImpl } = stubFetch([ok()]);
    const llm = createLlm({ cacheDir, fetchImpl, prices, retryDelayMs: 0, now: () => new Date('2026-11-21T12:00:00Z') });
    const first = await llm.chat(req);
    expect(first.usage).toEqual({ inputTokens: 100, cachedInputTokens: 40, outputTokens: 10 });
    expect(first.costUsd).toBeCloseTo((60 * 0.15 + 40 * 0.003 + 10 * 0.6) / 1e6, 12);
    expect(first.cached).toBe(false);
    const second = await llm.chat({ ...req });
    expect(calls).toHaveLength(1);
    expect(second.cached).toBe(true);
    expect(second.message).toEqual(first.message);
    expect(llm.totals()).toEqual({ calls: 2, cachedCalls: 1, costUsd: first.costUsd });
  });

  it('cache hit does not depend on session id', async () => {
    const a = stubFetch([ok()]);
    await createLlm({ cacheDir, sessionId: 's1', fetchImpl: a.fetchImpl, prices, retryDelayMs: 0 }).chat(req);
    const b = stubFetch([ok()]);
    const r = await createLlm({ cacheDir, sessionId: 's2', fetchImpl: b.fetchImpl, prices, retryDelayMs: 0 }).chat(req);
    expect(b.calls).toHaveLength(0);
    expect(r.cached).toBe(true);
  });

  it('4xx throws immediately and is not cached', async () => {
    const { calls, fetchImpl } = stubFetch([() => new Response('{"error":"MissingSessionID"}', { status: 400 })]);
    const llm = createLlm({ cacheDir, fetchImpl, prices, retryDelayMs: 0 });
    await expect(llm.chat(req)).rejects.toThrow(/400/);
    expect(calls).toHaveLength(1);
    expect(readdirSync(cacheDir, { recursive: true }).filter((f) => String(f).endsWith('.json'))).toEqual([]);
  });

  it('retries 5xx/429 up to 3 attempts, then succeeds', async () => {
    const { calls, fetchImpl } = stubFetch([() => new Response('x', { status: 503 }), () => new Response('x', { status: 429 }), ok()]);
    const r = await createLlm({ cacheDir, fetchImpl, prices, retryDelayMs: 0 }).chat(req);
    expect(calls).toHaveLength(3);
    expect(r.message.content).toBe('hi');
  });

  it('gives up after 3 failed attempts and caches nothing', async () => {
    const { calls, fetchImpl } = stubFetch([() => new Response('x', { status: 500 })]);
    await expect(createLlm({ cacheDir, fetchImpl, prices, retryDelayMs: 0 }).chat(req)).rejects.toThrow(/500/);
    expect(calls).toHaveLength(3);
    expect(readdirSync(cacheDir, { recursive: true }).filter((f) => String(f).endsWith('.json'))).toEqual([]);
  });

  it('retries network errors', async () => {
    let n = 0;
    const fetchImpl = (async () => {
      if (n++ === 0) throw new TypeError('fetch failed');
      return ok()();
    }) as unknown as typeof fetch;
    const r = await createLlm({ cacheDir, fetchImpl, prices, retryDelayMs: 0 }).chat(req);
    expect(n).toBe(2);
    expect(r.cached).toBe(false);
  });

  it('keeps tool_calls in the message', async () => {
    const tc = [{ id: 'c1', type: 'function', function: { name: 'get_time', arguments: '{}' } }];
    const { fetchImpl } = stubFetch([ok({ role: 'assistant', content: null, tool_calls: tc })]);
    const r = await createLlm({ cacheDir, fetchImpl, prices, retryDelayMs: 0 }).chat(req);
    expect(r.message.tool_calls).toEqual(tc);
  });

  it('never writes the API key into the cache', async () => {
    const { fetchImpl } = stubFetch([ok()]);
    await createLlm({ cacheDir, fetchImpl, prices, retryDelayMs: 0 }).chat(req);
    const files = readdirSync(cacheDir, { recursive: true }).map(String).filter((f) => f.endsWith('.json'));
    expect(files.length).toBe(1);
    for (const f of files) expect(readFileSync(join(cacheDir, f), 'utf8')).not.toContain(KEY);
  });

  it('opencode without key fails before any network call', async () => {
    delete process.env.OPENCODE_API_KEY;
    const { calls, fetchImpl } = stubFetch([ok()]);
    await expect(createLlm({ cacheDir, fetchImpl, prices, retryDelayMs: 0 }).chat(req)).rejects.toThrow(/OPENCODE_API_KEY/);
    expect(calls).toHaveLength(0);
  });

  it('on 429 waits Retry-After seconds and retries more patiently than on 5xx', async () => {
    const waits: number[] = [];
    const r429 = () => new Response('slow down', { status: 429, headers: { 'retry-after': '5' } });
    const { calls, fetchImpl } = stubFetch([r429, r429, r429, r429, ok()]);
    const r = await createLlm({ cacheDir, fetchImpl, prices, retryDelayMs: 1, sleep: async (ms) => void waits.push(ms) }).chat(req);
    expect(r.cached).toBe(false);
    expect(calls).toHaveLength(5);
    expect(waits.slice(0, 4)).toEqual([5000, 5000, 5000, 5000]);
  });

  it('gives up on 429 after 8 attempts', async () => {
    const { calls, fetchImpl } = stubFetch([() => new Response('x', { status: 429 })]);
    await expect(createLlm({ cacheDir, fetchImpl, prices, retryDelayMs: 0, sleep: async () => {} }).chat(req)).rejects.toThrow(/429/);
    expect(calls).toHaveLength(8);
  });
});
