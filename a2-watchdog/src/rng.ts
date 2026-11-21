/** Stateless hash -> [0,1): the same inputs always give the same number, so reruns are reproducible. */
export function u(...xs: number[]): number {
  let h = 0x9e3779b9;
  for (const x of xs) {
    h ^= Math.imul((x | 0) + 0x7f4a7c15, 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return (h >>> 0) / 4294967296;
}
export const pick = <T>(xs: readonly T[], r: number): T => xs[Math.min(xs.length - 1, Math.floor(r * xs.length))]!;
