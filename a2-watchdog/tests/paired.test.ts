import { describe, expect, it } from 'vitest';
import { pairedDiff } from '../src/paired.ts';

describe('paired difference', () => {
  it('mean of a-b with a normal 95% interval of the mean', () => {
    const r = pairedDiff([3, 5, 7, 9], [1, 1, 1, 1]);
    expect(r.mean).toBe(5);
    // diffs 2,4,6,8: sd = 2.582, se = 1.291, half-width 1.96 * se = 2.53
    expect(r.half).toBeCloseTo(2.53, 2);
    expect(r.aWins).toBe(0);
  });
  it('counts histories where a is cheaper', () => {
    expect(pairedDiff([1, 5, 0], [2, 4, 3]).aWins).toBe(2);
  });
});
