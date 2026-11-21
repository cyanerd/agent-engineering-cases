import { describe, expect, it } from 'vitest';
import { anyFailure } from '../src/detectors.ts';
import { evaluate } from '../src/evaluate.ts';
import { fingerprint } from '../src/fingerprint.ts';
import { generateHistory, RUNS_PER_WEEK } from '../src/history.ts';

describe('generateHistory', () => {
  it('is deterministic for a seed and differs across seeds', () => {
    const data = (seed: number) => {
      const { rerun: _r, ...rest } = generateHistory(seed);
      return rest;
    };
    const a = data(1);
    expect(data(1)).toEqual(a);
    expect(generateHistory(2).episodes).not.toEqual(a.episodes);
  });

  it('has 30 scenarios x 3 runs a day x 4 weeks, and episodes of all four kinds', () => {
    const h = generateHistory(1);
    expect(h.scenarios).toHaveLength(30);
    expect(h.runs).toHaveLength(4 * RUNS_PER_WEEK);
    expect(new Set(h.episodes.map((e) => e.kind))).toEqual(new Set(['stable', 'intermittent', 'disguised', 'degradation']));
  });

  it('calibration: "red on any failure" gives ~40 signals a week, ~30 of them flaky (median over 20 seeds)', () => {
    const per: { all: number; flaky: number }[] = [];
    for (let seed = 1; seed <= 20; seed++) {
      const h = generateHistory(seed);
      const r = evaluate(anyFailure()(h).alerts, h);
      per.push({ all: r.alertsPerWeek, flaky: r.falseAlertsPerWeek });
    }
    const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
    expect(med(per.map((p) => p.all))).toBeGreaterThanOrEqual(32);
    expect(med(per.map((p) => p.all))).toBeLessThanOrEqual(48);
    expect(med(per.map((p) => p.flaky))).toBeGreaterThanOrEqual(24);
    expect(med(per.map((p) => p.flaky))).toBeLessThanOrEqual(36);
  });

  it('a rerun sees the same state: inside a stable episode reruns fail too; outside, a flaky scenario passes most reruns', () => {
    const h = generateHistory(3);
    const ep = h.episodes.find((e) => e.kind === 'stable')!;
    const inEp = Array.from({ length: 10 }, (_, k) => h.rerun(ep.scenario, ep.start, k + 1).ok);
    expect(inEp.filter((ok) => !ok).length).toBeGreaterThanOrEqual(8);
    const flaky = h.scenarios.find((s) => s.flakeRate > 0)!;
    const quiet = Array.from({ length: 200 }, (_, k) => h.rerun(flaky.id, 0, k + 1).ok);
    expect(quiet.filter((ok) => !ok).length / 200).toBeCloseTo(flaky.flakeRate, 1);
  });

  it('a disguised episode fails with the same fingerprint as the scenario\'s flaky timeout', () => {
    const h = generateHistory(1);
    const ep = h.episodes.find((e) => e.kind === 'disguised')!;
    const failing = h.runs.slice(ep.start, ep.end).map((r) => r[ep.scenario]!).find((r) => !r.ok)!;
    const flakes = h.runs.flatMap((r) => r).filter((r) => r.scenario === ep.scenario && !r.ok && r.cause?.startsWith('flake-timeout'));
    expect(flakes.length).toBeGreaterThan(0);
    expect(fingerprint(failing)).toBe(fingerprint(flakes[0]!));
  });
});

describe('fingerprint', () => {
  it('ignores numbers, ids and quoted values but keeps the step and error kind', () => {
    const a = fingerprint({ step: 'checkout', message: 'Timeout 30000ms exceeded waiting for locator(\'#pay-7f3a\')' });
    const b = fingerprint({ step: 'checkout', message: 'Timeout 15000ms exceeded waiting for locator(\'#pay-91bc\')' });
    const c = fingerprint({ step: 'login', message: 'Timeout 30000ms exceeded waiting for locator(\'#pay-7f3a\')' });
    const d = fingerprint({ step: 'checkout', message: 'Error: 502 Bad Gateway from payments-sandbox (request id 9f2c11aa)' });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toBe(d);
  });
});

describe('evaluate', () => {
  it('counts detection, hours to detect and false alerts per episode', () => {
    const h = generateHistory(1);
    const ep = h.episodes[0]!;
    const r = evaluate([{ scenario: ep.scenario, t: ep.start + 1 }, { scenario: ep.scenario, t: ep.start + 2 }, { scenario: (ep.scenario + 1) % 30, t: 0 }], h);
    expect(r.detected).toBe(1);
    expect(r.episodes).toBe(h.episodes.length);
    expect(r.hoursToDetect[0]).toBe(8);
    expect(r.falseAlerts).toBe(h.episodes.some((e) => e.scenario === (ep.scenario + 1) % 30 && e.start <= 0 && 0 < e.end) ? 0 : 1);
  });
});
