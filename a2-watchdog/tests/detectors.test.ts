import { describe, expect, it } from 'vitest';
import { fingerprints, fingerprintsThenRerun, rerun, windowStats } from '../src/detectors.ts';
import type { Episode, History, Run } from '../src/history.ts';

const ok = (s: number, t: number, attempt = 0): Run => ({ scenario: s, t, attempt, ok: true });
const fail = (s: number, t: number, message: string, attempt = 0, step = 'pay'): Run => ({ scenario: s, t, attempt, ok: false, step, message, cause: 'break' });

/** One scenario, a given scheduled timeline, reruns answered by a function of (t, k). */
function mini(timeline: Run[], rerunAt: (t: number, k: number) => Run, episodes: Episode[] = []): History {
  return {
    seed: 0,
    scenarios: [{ id: 0, name: 's', steps: ['pay'], flakeRate: 0, causes: {}, timeoutStep: 'pay' }],
    episodes,
    runs: timeline.map((r) => [r]),
    rerun: (_s, t, k) => rerunAt(t, k),
  };
}
const TIMEOUT = "Timeout 30000ms exceeded waiting for locator('#result-0a1b2c')";
const BREAK = 'Error: expected status 200, got 500 at POST /api/orders';

describe('rerun detector', () => {
  it('a failure that passes on rerun is a flake: no alert, one extra run', () => {
    const h = mini([ok(0, 0), fail(0, 1, TIMEOUT), ok(0, 2)], (t, k) => ok(0, t, k));
    expect(rerun({ k: 2 })(h)).toEqual({ alerts: [], extraRuns: 1 });
  });
  it('a failure that keeps failing on all reruns is an alert', () => {
    const h = mini([ok(0, 0), fail(0, 1, BREAK)], (t, k) => fail(0, t, BREAK, k));
    expect(rerun({ k: 2 })(h)).toEqual({ alerts: [{ scenario: 0, t: 1 }], extraRuns: 2 });
  });
  it('quarantine silences a scenario that flakes often - including a real break that starts there', () => {
    const timeline = Array.from({ length: 30 }, (_, t) => (t % 3 === 0 && t < 20 ? fail(0, t, TIMEOUT) : ok(0, t)));
    for (let t = 24; t < 30; t++) timeline[t] = fail(0, t, BREAK);
    const h = mini(timeline, (t, k) => (t >= 24 ? fail(0, t, BREAK, k) : ok(0, t, k)));
    expect(rerun({ k: 2 })(h).alerts.length).toBeGreaterThan(0);
    expect(rerun({ k: 2, quarantine: { rate: 0.1, window: 21 } })(h).alerts).toEqual([]);
  });
});

describe('window statistics (sequential test)', () => {
  it('a single failure in a scenario that fails 20% of the time is not a signal; a run of failures is', () => {
    const base = Array.from({ length: 40 }, (_, t) => (t % 5 === 0 ? fail(0, t, TIMEOUT) : ok(0, t)));
    const h1 = mini(base, (t, k) => ok(0, t, k));
    expect(windowStats({ threshold: 3 })(h1).alerts).toEqual([]);
    const broken = [...base, ...Array.from({ length: 5 }, (_, i) => fail(0, 40 + i, BREAK))];
    const alerts = windowStats({ threshold: 3 })(mini(broken, (t, k) => ok(0, t, k))).alerts;
    expect(alerts.length).toBe(1);
    expect(alerts[0]!.t).toBeGreaterThanOrEqual(40);
    expect(alerts[0]!.t).toBeLessThanOrEqual(43);
  });
  it('makes no extra runs', () => {
    expect(windowStats({ threshold: 3 })(mini([fail(0, 0, BREAK)], (t, k) => ok(0, t, k))).extraRuns).toBe(0);
  });
});

describe('fingerprints', () => {
  it('the first occurrence of a signature is a signal, repeats of a known one are not', () => {
    const h = mini([fail(0, 0, TIMEOUT), ok(0, 1), fail(0, 2, "Timeout 5000ms exceeded waiting for locator('#result-ffee00')"), fail(0, 3, BREAK)], (t, k) => ok(0, t, k));
    expect(fingerprints({})(h).alerts).toEqual([{ scenario: 0, t: 0 }, { scenario: 0, t: 3 }]);
  });
  it('a real break that looks like a known flake is missed', () => {
    const h = mini([fail(0, 0, TIMEOUT), ok(0, 1), fail(0, 2, TIMEOUT), fail(0, 3, TIMEOUT)], (t, k) => ok(0, t, k));
    expect(fingerprints({})(h).alerts).toEqual([{ scenario: 0, t: 0 }]);
  });
  it('signatures learned during warm-up do not alert later', () => {
    const h = mini([fail(0, 0, TIMEOUT), ok(0, 1), fail(0, 2, TIMEOUT)], (t, k) => ok(0, t, k));
    expect(fingerprints({ warmupUntil: 2 })(h).alerts).toEqual([]);
  });
});

describe('fingerprints, then rerun for known signatures', () => {
  it('a new signature is a signal right away, without a rerun', () => {
    const h = mini([ok(0, 0), fail(0, 1, BREAK)], (t, k) => ok(0, t, k));
    expect(fingerprintsThenRerun({ k: 1 })(h)).toEqual({ alerts: [{ scenario: 0, t: 1 }], extraRuns: 0 });
  });
  it('a known signature is rerun: passes - no signal; keeps failing - signal', () => {
    const h = mini([fail(0, 0, TIMEOUT), fail(0, 1, TIMEOUT), fail(0, 2, TIMEOUT)], (t, k) => (t === 2 ? fail(0, t, TIMEOUT, k) : ok(0, t, k)));
    expect(fingerprintsThenRerun({ k: 1, warmupUntil: 1 })(h)).toEqual({ alerts: [{ scenario: 0, t: 2 }], extraRuns: 2 });
  });
  it('with k=2 a known signature that passes on the second rerun is a flake: two extra runs, no signal', () => {
    const h = mini([fail(0, 0, TIMEOUT), fail(0, 1, TIMEOUT)], (t, k) => (k === 1 ? fail(0, t, TIMEOUT, k) : ok(0, t, k)));
    expect(fingerprintsThenRerun({ k: 2, warmupUntil: 1 })(h)).toEqual({ alerts: [], extraRuns: 2 });
  });
  it('a new signature during warm-up is learned without a rerun', () => {
    let reruns = 0;
    const h = mini([fail(0, 0, BREAK)], (t, k) => (reruns++, ok(0, t, k)));
    fingerprintsThenRerun({ k: 2, warmupUntil: 5 })(h);
    expect(reruns).toBe(0);
  });
  it('signatures seen during warm-up are learned silently', () => {
    const h = mini([fail(0, 0, TIMEOUT), ok(0, 1)], (t, k) => ok(0, t, k));
    expect(fingerprintsThenRerun({ k: 1, warmupUntil: 1 })(h)).toEqual({ alerts: [], extraRuns: 0 });
  });
});
