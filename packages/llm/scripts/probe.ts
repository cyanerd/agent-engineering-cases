/**
 * Probes the three pinned models: plain answer, one tool call, json_object answer.
 * Usage: pnpm --filter @aec/llm run probe   (needs OPENCODE_API_KEY in ../../.env and a running Ollama)
 */
import { randomUUID } from 'node:crypto';
import { createLlm, loadPrices, type ChatRequest, type Provider } from '../src/index.ts';

process.loadEnvFile?.(new URL('../../../.env', import.meta.url));

const MODELS: { role: string; provider: Provider; model: string }[] = [
  { role: 'local', provider: 'ollama', model: process.env.PROBE_LOCAL_MODEL ?? 'qwen3:8b' },
  { role: 'cloud-cheap', provider: 'opencode', model: 'deepseek-v4.1-flash' },
  { role: 'cloud-strong', provider: 'opencode', model: 'deepseek-v4-pro' },
];

const getTime = {
  type: 'function' as const,
  function: {
    name: 'get_time',
    description: 'Returns the current time in the given IANA timezone.',
    parameters: { type: 'object', properties: { timezone: { type: 'string' } }, required: ['timezone'] },
  },
};

const prices = await loadPrices(fetch, { refreshSnapshot: true });
const llm = createLlm({ sessionId: randomUUID(), prices, cacheDir: new URL('../../../.cache/llm', import.meta.url).pathname });

for (const m of MODELS) {
  const base = { provider: m.provider, model: m.model, temperature: 0 } satisfies Partial<ChatRequest>;
  const checks: Record<string, ChatRequest> = {
    plain: { ...base, messages: [{ role: 'user', content: 'Answer with one word: what is the capital of France?' }] },
    tool: { ...base, tools: [getTime], messages: [{ role: 'user', content: 'What time is it in Bangkok? Use the tool.' }] },
    json: {
      ...base,
      responseFormat: { type: 'json_object' },
      messages: [{ role: 'user', content: 'Return JSON {"city": string, "country": string} for the capital of Japan.' }],
    },
  };
  for (const [name, req] of Object.entries(checks)) {
    try {
      const r = await llm.chat(req);
      let verdict: string;
      if (name === 'tool') verdict = r.message.tool_calls?.[0]?.function.name === 'get_time' ? 'tool_call ok' : 'NO tool_call';
      else if (name === 'json') {
        try {
          const o = JSON.parse(String(r.message.content).replace(/^```json\s*|```\s*$/g, ''));
          verdict = typeof o.city === 'string' ? 'json ok' : 'json wrong shape';
        } catch {
          verdict = 'json INVALID';
        }
      } else verdict = /paris/i.test(String(r.message.content)) ? 'ok' : `unexpected: ${String(r.message.content).slice(0, 60)}`;
      console.log(
        [m.role, m.model, name, verdict, `${r.latencyMs}ms`, `in=${r.usage.inputTokens} out=${r.usage.outputTokens}`, `$${r.costUsd.toFixed(6)}`, r.cached ? 'cached' : 'live'].join(' | '),
      );
    } catch (e) {
      console.log([m.role, m.model, name, `ERROR ${(e as Error).message.slice(0, 200)}`].join(' | '));
    }
  }
}
console.log('totals', llm.totals());
