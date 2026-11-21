/**
 * Runs scenarios x profiles x models x samples and writes results/<model>/<profile>.jsonl.
 *   pnpm --filter b2-mail-injection runs -- --models flash --samples 3
 *   --models qwen,flash,pro   --profiles L0-baseline,full   --samples N   --filter <regex on scenario id>
 *   --pilot (10 attacks + 6 benign)   --all (every model with its default sample count)
 * Model responses are cached on disk, so a re-run with a warm cache makes no network calls.
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createLlm, loadSnapshot } from '@aec/llm';
import { runScenario, type ModelRef, type RunRecord } from './agent.ts';
import { loadCorpus } from './corpus.ts';
import { PROFILES } from './profiles.ts';

const ROOT = new URL('../', import.meta.url);
process.loadEnvFile?.(new URL('../.env', ROOT));

export const MODELS: Record<string, ModelRef & { concurrency: number; samples: number; profiles?: string[] }> = {
  qwen: { provider: 'ollama', model: process.env.B2_LOCAL_MODEL ?? 'qwen3:8b', concurrency: 4, samples: 1 },
  flash: { provider: 'opencode', model: 'deepseek-v4.1-flash', concurrency: 2, samples: 3 },
  pro: { provider: 'opencode', model: 'deepseek-v4-pro', concurrency: 2, samples: 1, profiles: ['L0-baseline', 'L1-prompt', 'full'] },
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

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

const slug = (s: string) => s.replace(/[^a-zA-Z0-9.+-]/g, '_');

async function main() {
  let corpus = loadCorpus();
  const filter = arg('filter');
  if (filter) corpus = corpus.filter((s) => new RegExp(filter).test(s.id));
  if (flag('pilot')) {
    const attacks = corpus.filter((s) => s.kind === 'attack');
    const pick = attacks.filter((_, i) => i % Math.ceil(attacks.length / 10) === 0).slice(0, 10);
    corpus = [...pick, ...corpus.filter((s) => s.kind === 'benign').filter((_, i) => i % 4 === 0).slice(0, 6)];
  }
  const modelKeys = (flag('all') ? Object.keys(MODELS) : (arg('models') ?? 'flash').split(','));
  const outDir = arg('out') ?? new URL('results/', new URL('../', import.meta.url)).pathname;
  const llm = createLlm({
    sessionId: randomUUID(),
    prices: await loadSnapshot(),
    cacheDir: process.env.LLM_CACHE_DIR ?? new URL('.cache/llm', ROOT).pathname,
  });
  for (const key of modelKeys) {
    const m = MODELS[key];
    if (!m) throw new Error(`unknown model ${key}`);
    const samples = Number(arg('samples') ?? m.samples);
    const profileIds = arg('profiles')?.split(',') ?? m.profiles ?? PROFILES.map((p) => p.id);
    for (const p of PROFILES.filter((x) => profileIds.includes(x.id))) {
      const jobs = corpus.flatMap((s) => Array.from({ length: samples }, (_, sample) => ({ s, sample })));
      const started = Date.now();
      const records: RunRecord[] = await pool(jobs, m.concurrency, ({ s, sample }) => runScenario(s, p, m, sample, llm));
      const dir = `${outDir}/${slug(m.model)}`;
      mkdirSync(dir, { recursive: true });
      const traces = `${dir}/traces`;
      mkdirSync(traces, { recursive: true });
      const lines = records.map(({ transcript, ...r }) => JSON.stringify(r));
      writeFileSync(`${dir}/${slug(p.id)}.jsonl`, `${lines.join('\n')}\n`);
      // Keep transcripts only for leaks and errors: they are the examples the report quotes.
      for (const r of records.filter((x) => x.verdict.leaked || x.error))
        writeFileSync(`${traces}/${slug(p.id)}__${r.scenarioId}__${r.sample}.json`, JSON.stringify(r, null, 2));
      const leaks = records.filter((r) => r.kind === 'attack' && r.verdict.leaked).length;
      const errs = records.filter((r) => r.error).length;
      console.log(`${m.model} ${p.id}: ${records.length} runs, leaks ${leaks}, errors ${errs}, ${((Date.now() - started) / 1000).toFixed(0)}s`, llm.totals());
    }
  }
}

await main();
