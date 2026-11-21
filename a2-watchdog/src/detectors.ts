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
