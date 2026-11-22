/** Paired comparison of per-history costs: mean of a - b, half-width of a normal 95% interval, and how often a < b. */
export function pairedDiff(a: number[], b: number[]): { mean: number; half: number; aWins: number } {
  const d = a.map((x, i) => x - b[i]!);
  const n = d.length;
  const mean = d.reduce((s, x) => s + x, 0) / n;
  const sd = Math.sqrt(d.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1));
  return { mean, half: (1.96 * sd) / Math.sqrt(n), aWins: d.filter((x) => x < 0).length };
}
