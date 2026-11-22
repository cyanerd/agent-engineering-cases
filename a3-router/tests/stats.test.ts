import { describe, expect, it } from 'vitest';
import { pairedBootstrap } from '../src/stats.ts';

describe('pairedBootstrap', () => {
  it('identical vectors give zero difference and a zero-width interval', () => {
    const a = Array.from({ length: 100 }, (_, i) => i % 3 === 0);
    expect(pairedBootstrap(a, a)).toEqual({ diff: 0, lo: 0, hi: 0 });
  });
  it('10 extra wins out of 100 give diff 0.1 inside the interval', () => {
    const b = Array.from({ length: 100 }, (_, i) => i < 50);
    const a = Array.from({ length: 100 }, (_, i) => i < 60);
    const r = pairedBootstrap(a, b);
    expect(r.diff).toBeCloseTo(0.1, 10);
    expect(r.lo).toBeLessThan(0.1);
    expect(r.hi).toBeGreaterThan(0.1);
    expect(r.lo).toBeGreaterThan(0);
  });
  it('is deterministic for a seed', () => {
    const a = Array.from({ length: 50 }, (_, i) => i % 2 === 0);
    const b = Array.from({ length: 50 }, (_, i) => i % 3 === 0);
    expect(pairedBootstrap(a, b, 2000, 7)).toEqual(pairedBootstrap(a, b, 2000, 7));
  });
  it('rejects vectors of different length', () => {
    expect(() => pairedBootstrap([true], [true, false])).toThrow();
  });
});

describe('shadowPower', () => {
  it('no difference at all always passes; a true loss beyond the margin almost never does', async () => {
    const { shadowPower } = await import('../src/stats.ts');
    expect(shadowPower(Array(100).fill(0), 200, 0.02)).toBe(1);
    const worse = [...Array(90).fill(0), ...Array(10).fill(-1)]; // -10 p.p.
    expect(shadowPower(worse, 1000, 0.02)).toBeLessThan(0.01);
  });
  it('power grows with the number of shadow comparisons and is reproducible', async () => {
    const { shadowPower } = await import('../src/stats.ts');
    const d = [...Array(238).fill(0), -1, -1]; // -0.83 p.p., like the stand
    const p = [130, 1000, 4000].map((n) => shadowPower(d, n, 0.02));
    expect(p[0]!).toBeLessThan(p[1]!);
    expect(p[1]!).toBeLessThan(p[2]! + 1e-9);
    expect(shadowPower(d, 500, 0.02)).toBe(shadowPower(d, 500, 0.02));
  });
});
