/** murmur3 finaliser: a full-avalanche 32-bit mix. */
function fmix(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}
/**
 * Stateless hash -> [0,1): the same inputs always give the same number, so reruns are reproducible.
 * Each input is mixed separately before combining, so draws that differ in one input are independent
 * (the first version mixed too little and correlated triples of attempts - found in review).
 */
export function u(...xs: number[]): number {
  let h = 0x2545f491;
  for (let i = 0; i < xs.length; i++) h = fmix(h ^ fmix(((xs[i]! | 0) + Math.imul(i + 1, 0x9e3779b9)) >>> 0));
  return h / 4294967296;
}
export const pick = <T>(xs: readonly T[], r: number): T => xs[Math.min(xs.length - 1, Math.floor(r * xs.length))]!;
