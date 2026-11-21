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
