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
export const windowStats = (opts: { threshold: number; window?: number; skipRecent?: number }): Detector => (h) => {
  const W = opts.window ?? 63;
  const skip = opts.skipRecent ?? 6;
  const alerts: Alert[] = [];
  const S = h.scenarios.length;
  const past: boolean[][] = Array.from({ length: S }, () => []);
  const cusum = new Array<number>(S).fill(0);
  const muted = new Array<boolean>(S).fill(false);
  for (let t = 0; t < h.runs.length; t++) {
    for (const r of h.runs[t]!) {
      const s = r.scenario;
      // Baseline from a sliding window that leaves out the most recent runs, so an ongoing breakage
      // does not raise its own baseline.
      const base = past[s]!.slice(-(W + skip), past[s]!.length - skip > 0 ? past[s]!.length - skip : 0);
      const fails = base.filter((ok) => !ok).length;
      const p0 = Math.min(0.5, Math.max(0.02, (fails + 1) / (base.length + 2)));
      const p1 = Math.min(0.95, Math.max(0.5, 3 * p0));
      cusum[s] = Math.max(0, cusum[s]! + (r.ok ? Math.log((1 - p1) / (1 - p0)) : Math.log(p1 / p0)));
      past[s]!.push(r.ok);
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

/**
 * Mechanisms 3 + 1. A failure with a signature never seen before is a signal right away, with no rerun.
 * A failure with a known signature is rerun up to k times; a signal only if every attempt fails.
 * Signatures seen before `warmupUntil` are learned without signalling.
 */
export const fingerprintsThenRerun = (opts: { k: number; warmupUntil?: number }): Detector => (h) => {
  const alerts: Alert[] = [];
  const known = new Set<string>();
  let extraRuns = 0;
  for (let t = 0; t < h.runs.length; t++) {
    for (const r of h.runs[t]!) {
      if (r.ok) continue;
      const live = t >= (opts.warmupUntil ?? 0);
      const sig = `${r.scenario}#${fingerprint(r)}`;
      if (!known.has(sig)) {
        known.add(sig);
        if (live) alerts.push({ scenario: r.scenario, t });
        continue;
      }
      let passed = false;
      for (let k = 1; k <= opts.k && !passed; k++) {
        extraRuns++;
        passed = h.rerun(r.scenario, t, k).ok;
      }
      if (!passed && live) alerts.push({ scenario: r.scenario, t });
    }
  }
  return { alerts, extraRuns };
};
