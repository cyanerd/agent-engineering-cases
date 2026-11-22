/**
 * Runs the agent on every case in both input modes and records what it would have paid for:
 * results/runs-<model>.jsonl - one line per (case, mode, sample) with the cart HTML and the order at payment time.
 *   pnpm --filter a1-booking runs -- --limit 20 --modes free,schema
 * Model answers are cached: a re-run with a warm cache makes no network calls.
 * --script runs the brittle scripted bot (no model) instead: results/runs-script.jsonl, schema mode only.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createLlm, loadSnapshot } from '@aec/llm';
import { chromium } from 'playwright';
import { runAgent, type InputMode, type ModelRef } from './agent.ts';
import { intents } from './intent.ts';
import { runScript } from './script-agent.ts';
import { startSite } from './site/server.ts';

const ROOT = new URL('../../', import.meta.url);
process.loadEnvFile?.(new URL('.env', ROOT));
const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const MODEL: ModelRef = { provider: 'opencode', model: process.env.A1_MODEL ?? 'deepseek-v4.1-flash' };
const CONCURRENCY = Number(arg('concurrency') ?? 2);
const SCRIPT = process.argv.includes('--script');
const LABEL = SCRIPT ? 'script' : MODEL.model;

async function main() {
  const modes = (SCRIPT ? 'schema' : arg('modes') ?? 'free,schema').split(',') as InputMode[];
  const all = intents();
  const limit = Number(arg('limit') ?? all.length);
  // Take an even split of main and broken layouts for a limited run.
  const cases = limit >= all.length ? all : [...all.filter((c) => c.layout === 'main').slice(0, Math.ceil(limit / 2)), ...all.filter((c) => c.layout !== 'main').slice(0, Math.floor(limit / 2))];
  const out = new URL(`../results/runs-${LABEL.replace(/[^a-zA-Z0-9.-]/g, '_')}.jsonl`, import.meta.url);
  const done = new Map<string, string>();
  if (existsSync(out)) for (const l of readFileSync(out, 'utf8').split('\n').filter(Boolean)) done.set(`${JSON.parse(l).caseId}/${JSON.parse(l).mode}`, l);

  const site = await startSite(0);
  const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
  const llm = createLlm({ sessionId: randomUUID(), prices: await loadSnapshot(), cacheDir: process.env.LLM_CACHE_DIR ? new URL(process.env.LLM_CACHE_DIR, ROOT).pathname : new URL('.cache/llm', ROOT).pathname });
  const jobs = cases.flatMap((c) => modes.map((mode) => ({ c, mode })));
  let next = 0;
  let finished = 0;
  const started = Date.now();
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < jobs.length) {
        const { c, mode } = jobs[next++]!;
        const runId = `${c.id}-${mode}`;
        const run = SCRIPT ? await runScript({ site, browser, c, runId }) : await runAgent({ site, browser, c, mode, sample: 0, llm, model: MODEL, runId });
        const cartHtml = await (await fetch(`${site.url}/cart?run=${encodeURIComponent(runId)}`)).text();
        const order = { items: site.cart(runId) };
        const rec = { ...run, layout: c.layout, intent: c.intent, cartHtml, order };
        done.set(`${c.id}/${mode}`, JSON.stringify(rec));
        finished++;
        if (finished % 10 === 0) console.log(`${finished}/${jobs.length} runs, ${((Date.now() - started) / 1000).toFixed(0)}s`, llm.totals());
      }
    }),
  );
  writeFileSync(out, `${[...done.values()].sort().join('\n')}\n`);
  await browser.close();
  await site.close();
  console.log('done', llm.totals());
}

await main();
