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

/**
 * Shadow mode, simulated: draw n paired differences (router correct − expensive correct) from `d` and apply the same
 * decision as offline - the lower end of a two-sided 95% interval above −delta (normal approximation). Returns the
 * share of `reps` simulated shadows that would prove non-inferiority.
 */
export function shadowPower(d: number[], n: number, delta: number, reps = 4000, seed = 7): number {
  const r = rng(seed);
  let pass = 0;
  for (let k = 0; k < reps; k++) {
    let s = 0;
    let s2 = 0;
    for (let i = 0; i < n; i++) {
      const x = d[Math.floor(r.next() * d.length)]!;
      s += x;
      s2 += x * x;
    }
    const mean = s / n;
    const sd = Math.sqrt(Math.max(0, (s2 - n * mean * mean) / Math.max(1, n - 1)));
    if (mean - 1.96 * (sd / Math.sqrt(n)) > -delta) pass++;
  }
  return pass / reps;
}
