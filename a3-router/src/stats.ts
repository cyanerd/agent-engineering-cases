import { rng } from './tasks/rng.ts';

/** Paired bootstrap of mean(a) - mean(b) over the same items; percentile 95% interval. */
export function pairedBootstrap(a: boolean[], b: boolean[], iters = 10_000, seed = 42): { diff: number; lo: number; hi: number } {
  if (a.length !== b.length) throw new Error('pairedBootstrap: vectors must have the same length');
  const n = a.length;
  const d = a.map((x, i) => Number(x) - Number(b[i]));
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);
  const diff = mean(d);
  const r = rng(seed);
  const samples: number[] = [];
  for (let k = 0; k < iters; k++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += d[Math.floor(r.next() * n)]!;
    samples.push(s / n);
  }
  samples.sort((x, y) => x - y);
  const q = (p: number) => samples[Math.min(samples.length - 1, Math.max(0, Math.floor(p * samples.length)))]!;
  return { diff, lo: q(0.025), hi: q(0.975) };
}
