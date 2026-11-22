import { describe, expect, it } from 'vitest';
import { generateHistory } from '../src/history.ts';
import { u } from '../src/rng.ts';

describe('rng', () => {
  it('three draws for the same (s, t) with different attempts are independent: P(all < 0.5) ~ 1/8', () => {
    let all = 0;
    const N = 200_000;
    for (let i = 0; i < N; i++) if (u(7, 20, i % 30, Math.floor(i / 30), 0) < 0.5 && u(7, 20, i % 30, Math.floor(i / 30), 1) < 0.5 && u(7, 20, i % 30, Math.floor(i / 30), 2) < 0.5) all++;
    expect(all / N).toBeGreaterThan(0.12);
    expect(all / N).toBeLessThan(0.13);
  });
});

describe('history v2', () => {
  it('has a "degradation" kind: a flaky scenario fails more often than usual, with its usual messages', () => {
    const h = generateHistory(1);
    const ep = h.episodes.find((e) => e.kind === 'degradation')!;
    expect(ep).toBeDefined();
    const sc = h.scenarios[ep.scenario]!;
    expect(sc.flakeRate).toBeGreaterThan(0);
    const inside = Array.from({ length: 400 }, (_, k) => h.rerun(ep.scenario, ep.start, k + 1));
    const rate = inside.filter((r) => !r.ok).length / 400;
    expect(rate).toBeGreaterThan(sc.flakeRate + 0.15);
    expect(rate).toBeLessThan(0.75);
    expect(inside.filter((r) => !r.ok).every((r) => r.cause?.startsWith('flake-'))).toBe(true);
  });
  it('"clean" scenarios still flake rarely (background 1%)', () => {
    const h = generateHistory(2);
    const clean = h.scenarios.filter((s) => s.flakeRate === 0.01);
    expect(clean.length).toBe(20);
  });
  it('the mix of breakage kinds can be changed for a sensitivity sweep', () => {
    const h = generateHistory(1, { disguised: 0, intermittentFail: 0.7 });
    expect(h.episodes.some((e) => e.kind === 'disguised')).toBe(false);
  });
});
