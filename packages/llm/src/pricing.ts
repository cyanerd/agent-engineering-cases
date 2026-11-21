import { readFile, writeFile } from 'node:fs/promises';
import type { PriceTable, Usage } from './types.ts';

export const MODELS_URL = 'https://opencode.ai/inference/go/v1/models';
export const SNAPSHOT_PATH = new URL('../prices.snapshot.json', import.meta.url);

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function hhmm(d: Date): string {
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

export function peakFactor(entry: PriceTable[string], at: Date): number {
  const p = entry.peak;
  if (!p || !p.weekdaysUtc.includes(DAYS[at.getUTCDay()]!)) return 1;
  const t = hhmm(at);
  return p.hoursUtc.some(([from, to]) => t >= from && t < to) ? p.factor : 1;
}

export function costUsd(model: string, usage: Usage, at: Date, prices: PriceTable): number {
  const entry = prices[model];
  if (!entry) return 0;
  const fresh = Math.max(0, usage.inputTokens - usage.cachedInputTokens);
  const base = fresh * entry.input + usage.cachedInputTokens * entry.cachedInput + usage.outputTokens * entry.output;
  return (base / 1_000_000) * peakFactor(entry, at);
}

type RawCond = { utc_hours?: { gte?: string; lt?: string } };
type RawMultiplier = { when?: { utc_days?: { in?: string[] }; any?: { all?: RawCond[] }[] }; factor?: number };
type RawModel = {
  id: string;
  cost?: { text?: { input?: { price?: number; cache?: { read?: number } }; output?: { price?: number } }; multipliers?: RawMultiplier[] };
};

/** Parses the OpenCode Go /v1/models payload. Only the first multiplier is supported; others are ignored. */
export function parsePrices(raw: unknown): PriceTable {
  const table: PriceTable = {};
  for (const m of ((raw as { data?: RawModel[] }).data ?? [])) {
    const t = m.cost?.text;
    if (t?.input?.price === undefined || t.output?.price === undefined) continue;
    const entry: PriceTable[string] = { input: t.input.price, cachedInput: t.input.cache?.read ?? t.input.price, output: t.output.price };
    const mul = m.cost?.multipliers?.[0];
    if (mul?.factor && mul.when?.utc_days?.in) {
      const hoursUtc = (mul.when.any ?? []).map((g) => {
        const gte = g.all?.find((c) => c.utc_hours?.gte)?.utc_hours?.gte ?? '00:00';
        const lt = g.all?.find((c) => c.utc_hours?.lt)?.utc_hours?.lt ?? '24:00';
        return [gte, lt] as [string, string];
      });
      entry.peak = { weekdaysUtc: mul.when.utc_days.in, hoursUtc, factor: mul.factor };
    }
    table[m.id] = entry;
  }
  return table;
}

/** Live prices when reachable (and refreshes the committed snapshot), otherwise the snapshot. */
export async function loadPrices(fetchImpl: typeof fetch = fetch, opts: { refreshSnapshot?: boolean } = {}): Promise<PriceTable> {
  try {
    const res = await fetchImpl(MODELS_URL);
    if (!res.ok) throw new Error(`prices ${res.status}`);
    const table = parsePrices(await res.json());
    if (opts.refreshSnapshot) {
      await writeFile(SNAPSHOT_PATH, `${JSON.stringify({ fetchedAt: new Date().toISOString(), source: MODELS_URL, prices: table }, null, 2)}\n`);
    }
    return table;
  } catch {
    return loadSnapshot();
  }
}

export async function loadSnapshot(): Promise<PriceTable> {
  try {
    return (JSON.parse(await readFile(SNAPSHOT_PATH, 'utf8')) as { prices: PriceTable }).prices;
  } catch {
    return {};
  }
}
