import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cacheKey, readCache, writeCache } from '../src/cache.ts';
import type { ChatRequest, ChatResult } from '../src/types.ts';

const base: ChatRequest = {
  provider: 'opencode',
  model: 'deepseek-v4.1-flash',
  messages: [{ role: 'user', content: 'hi' }],
  temperature: 0,
};

const result: ChatResult = {
  message: { role: 'assistant', content: 'hello' },
  usage: { inputTokens: 3, cachedInputTokens: 0, outputTokens: 2 },
  costUsd: 0.000001,
  latencyMs: 420,
  cached: false,
  model: 'deepseek-v4.1-flash',
};

describe('cacheKey', () => {
  it('ignores object key order', () => {
    const reordered = { temperature: 0, messages: [{ content: 'hi', role: 'user' }], model: 'deepseek-v4.1-flash', provider: 'opencode' } as ChatRequest;
    expect(cacheKey(reordered)).toBe(cacheKey(base));
  });

  it('changes with temperature, sample and tools', () => {
    const k = cacheKey(base);
    expect(cacheKey({ ...base, temperature: 0.7 })).not.toBe(k);
    expect(cacheKey({ ...base, sample: 1 })).not.toBe(k);
    expect(cacheKey({ ...base, sample: 2 })).not.toBe(cacheKey({ ...base, sample: 1 }));
    expect(cacheKey({ ...base, tools: [{ type: 'function', function: { name: 'f', description: 'd', parameters: {} } }] })).not.toBe(k);
  });

  it('changes with provider and model', () => {
    expect(cacheKey({ ...base, provider: 'ollama' })).not.toBe(cacheKey(base));
    expect(cacheKey({ ...base, model: 'deepseek-v4-pro' })).not.toBe(cacheKey(base));
  });
});

describe('disk cache', () => {
  it('returns the stored result marked cached, with original latency', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'llm-cache-'));
    await writeCache(dir, 'abc', result);
    const got = await readCache(dir, 'abc');
    expect(got).toEqual({ ...result, cached: true });
    expect(got?.latencyMs).toBe(420);
  });

  it('returns undefined on miss', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'llm-cache-'));
    expect(await readCache(dir, 'nope')).toBeUndefined();
  });

  it('parallel writes of one key leave valid JSON and no temp files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'llm-cache-'));
    await Promise.all(Array.from({ length: 20 }, (_, i) => writeCache(dir, 'same', { ...result, latencyMs: i })));
    const files = readdirSync(dir, { recursive: true }).map(String).filter((f) => f.endsWith('.json') || f.includes('.tmp'));
    expect(files.filter((f) => f.includes('.tmp'))).toEqual([]);
    const only = files.find((f) => f.endsWith('.json'))!;
    expect(() => JSON.parse(readFileSync(join(dir, only), 'utf8'))).not.toThrow();
  });
});
