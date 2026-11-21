import { fingerprint } from './fingerprint.ts';
import type { Alert } from './evaluate.ts';
import type { History } from './history.ts';

export interface DetectorResult {
  alerts: Alert[];
  /** Runs beyond the schedule (reruns). */
  extraRuns: number;
}
export type Detector = (h: History) => DetectorResult;

/** Baseline: every failed scheduled run is a signal. */
export const anyFailure = (): Detector => (h) => ({
  alerts: h.runs.flatMap((row) => row.filter((r) => !r.ok).map((r) => ({ scenario: r.scenario, t: r.t }))),
  extraRuns: 0,
});

/**
 * Mechanism 1. A failed run is rerun up to k times right away; a signal only if every attempt fails.
 * Optional quarantine: a scenario whose flake rate over the last `window` runs reaches `rate` stops paging
 * (it keeps running, with an owner and a deadline in real life; here the quarantine lifts when the window clears).
 */
export const rerun = (opts: { k: number; quarantine?: { rate: number; window: number } }): Detector => (h) => {
  const alerts: Alert[] = [];
  const flakes = new Map<number, number[]>();
  let extraRuns = 0;
  for (let t = 0; t < h.runs.length; t++) {
    for (const r of h.runs[t]!) {
      if (r.ok) continue;
      const s = r.scenario;
      if (opts.quarantine) {
        const recent = (flakes.get(s) ?? []).filter((x) => x >= t - opts.quarantine!.window).length;
        if (recent / opts.quarantine.window >= opts.quarantine.rate) {
          // Quarantined scenarios keep running; their failures count toward the rate but page nobody.
          flakes.set(s, [...(flakes.get(s) ?? []), t]);
          continue;
        }
      }
      let passed = false;
      for (let k = 1; k <= opts.k && !passed; k++) {
        extraRuns++;
        passed = h.rerun(s, t, k).ok;
      }
      if (passed) flakes.set(s, [...(flakes.get(s) ?? []), t]);
      else alerts.push({ scenario: s, t });
    }
  }
  return { alerts, extraRuns };
};

/**
 * Mechanism 2. Each scenario has a baseline failure rate p0 estimated from its own past; a one-sided CUSUM on the
 * log-likelihood ratio of "rate jumped to p1" vs "rate is p0" raises a signal when it crosses `threshold`.
 * After a signal the scenario stays muted until it passes again (one signal per incident).
 */
export const windowStats = (opts: { threshold: number }): Detector => (h) => {
  const alerts: Alert[] = [];
  const S = h.scenarios.length;
  const fails = new Array<number>(S).fill(0);
  const total = new Array<number>(S).fill(0);
  const cusum = new Array<number>(S).fill(0);
  const muted = new Array<boolean>(S).fill(false);
  for (let t = 0; t < h.runs.length; t++) {
    for (const r of h.runs[t]!) {
      const s = r.scenario;
      const p0 = Math.min(0.5, Math.max(0.02, (fails[s]! + 1) / (total[s]! + 2)));
      const p1 = Math.min(0.95, Math.max(0.5, 3 * p0));
      cusum[s] = Math.max(0, cusum[s]! + (r.ok ? Math.log((1 - p1) / (1 - p0)) : Math.log(p1 / p0)));
      total[s]!++;
      if (!r.ok) fails[s]!++;
      if (r.ok) muted[s] = false;
      if (!muted[s] && cusum[s]! >= opts.threshold) {
        alerts.push({ scenario: s, t });
        cusum[s] = 0;
        muted[s] = true;
      }
    }
  }
  return { alerts, extraRuns: 0 };
};

/**
 * Mechanism 3. Failures are grouped by signature (step + normalised error). A signature never seen before is a
 * signal; a known one is noise (its count still feeds a trend for humans). Signatures seen before `warmupUntil`
 * are learned without signalling.
 */
export const fingerprints = (opts: { warmupUntil?: number }): Detector => (h) => {
  const alerts: Alert[] = [];
  const known = new Set<string>();
  for (let t = 0; t < h.runs.length; t++) {
    for (const r of h.runs[t]!) {
      if (r.ok) continue;
      const sig = `${r.scenario}#${fingerprint(r)}`;
      if (known.has(sig)) continue;
      known.add(sig);
      if (t >= (opts.warmupUntil ?? 0)) alerts.push({ scenario: r.scenario, t });
    }
  }
  return { alerts, extraRuns: 0 };
};
