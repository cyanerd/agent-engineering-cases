/**
 * Answers every task with every model and writes results/answers.jsonl (merged per model, sorted).
 *   pnpm --filter a3-router runs -- --models qwen,flash,pro
 * Responses are cached on disk: a re-run with a warm cache makes no network calls.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createLlm, loadSnapshot, type ChatRequest, type ChatResult, type Provider } from '@aec/llm';
import { grade, loadTasks, stripThink, type Task } from './tasks/index.ts';

export interface ModelSpec {
  key: string;
  provider: Provider;
  model: string;
  /** Name recorded in results; defaults to model. */
  label?: string;
  /** Qwen3 soft switch: answer without the long reasoning phase (fast mode of a local model). */
  noThink?: boolean;
  samples: number;
  concurrency: number;
}
export interface AnswerRow {
  taskId: string;
  type: Task['type'];
  split: Task['split'];
  model: string;
  sample: number;
  output?: string;
  correct?: boolean;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  error?: string;
}

export const MODELS: Record<string, ModelSpec> = {
  qwen: { key: 'qwen', provider: 'ollama', model: 'qwen3:8b', samples: 3, concurrency: 4 },
  'qwen-fast': { key: 'qwen-fast', provider: 'ollama', model: 'qwen3:8b', label: 'qwen3:8b-nothink', noThink: true, samples: 3, concurrency: 4 },
  flash: { key: 'flash', provider: 'opencode', model: 'deepseek-v4.1-flash', samples: 1, concurrency: 2 },
  pro: { key: 'pro', provider: 'opencode', model: 'deepseek-v4-pro', samples: 1, concurrency: 2 },
};

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  }));
  return out;
}

const rowKey = (r: { taskId: string; model: string; sample: number }) => `${r.taskId}\u0000${r.model}\u0000${String(r.sample).padStart(3, '0')}`;
export const sortRows = (rows: AnswerRow[]) => [...rows].sort((a, b) => (rowKey(a) < rowKey(b) ? -1 : rowKey(a) > rowKey(b) ? 1 : 0));

/** Sample 0 is greedy (temperature 0); further samples use 0.7 for self-consistency. */
export async function answerTasks(tasks: Task[], models: ModelSpec[], llm: { chat(r: ChatRequest): Promise<ChatResult> }): Promise<AnswerRow[]> {
  const rows: AnswerRow[] = [];
  for (const m of models) {
    const jobs = tasks.flatMap((t) => Array.from({ length: m.samples }, (_, sample) => ({ t, sample })));
    rows.push(...(await pool(jobs, m.concurrency, async ({ t, sample }): Promise<AnswerRow> => {
      const base = { taskId: t.id, type: t.type, split: t.split, model: m.label ?? m.model, sample };
      try {
        const r = await llm.chat({
          provider: m.provider, model: m.model, messages: [...(m.noThink ? [{ role: 'system' as const, content: '/no_think' }] : []), { role: 'user' as const, content: t.prompt }],
          temperature: sample === 0 ? 0 : 0.7, sample,
          ...(t.type === 'extract' ? { responseFormat: { type: 'json_object' as const } } : {}),
        });
        const output = stripThink(r.message.content ?? '').slice(0, 4000);
        return { ...base, output, correct: grade(t, output), inputTokens: r.usage.inputTokens, outputTokens: r.usage.outputTokens, costUsd: r.costUsd, latencyMs: r.latencyMs };
      } catch (e) {
        return { ...base, inputTokens: 0, outputTokens: 0, costUsd: 0, latencyMs: 0, error: (e as Error).message.slice(0, 300) };
      }
    })));
  }
  return sortRows(rows);
}

async function main() {
  const root = new URL('../../', import.meta.url);
  process.loadEnvFile?.(new URL('.env', root));
  const i = process.argv.indexOf('--models');
  const keys = (i > 0 ? process.argv[i + 1]! : 'qwen,flash,pro').split(',');
  const specs = keys.map((k) => MODELS[k] ?? (() => { throw new Error(`unknown model ${k}`); })());
  const out = new URL('../results/answers.jsonl', import.meta.url);
  const llm = createLlm({ sessionId: randomUUID(), prices: await loadSnapshot(), cacheDir: process.env.LLM_CACHE_DIR ?? new URL('.cache/llm', root).pathname });
  const tasks = loadTasks();
  const existing: AnswerRow[] = existsSync(out) ? readFileSync(out, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  for (const spec of specs) {
    const started = Date.now();
    const fresh = await answerTasks(tasks, [spec], llm);
    const kept = existing.filter((r) => r.model !== (spec.label ?? spec.model));
    existing.length = 0;
    existing.push(...kept, ...fresh);
    writeFileSync(out, `${sortRows(existing).map((r) => JSON.stringify(r)).join('\n')}\n`);
    const ok = fresh.filter((r) => !r.error);
    console.log(`${spec.model}: ${fresh.length} answers, accuracy ${(ok.filter((r) => r.correct).length / Math.max(1, ok.length)).toFixed(3)}, errors ${fresh.length - ok.length}, ${((Date.now() - started) / 1000).toFixed(0)}s`, llm.totals());
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
