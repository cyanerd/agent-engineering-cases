import { HOURS_BETWEEN, type EpisodeKind, type History } from './history.ts';

export interface Alert {
  scenario: number;
  t: number;
}
export interface Evaluation {
  episodes: number;
  detected: number;
  recall: number;
  recallByKind: Record<EpisodeKind, { detected: number; total: number }>;
  hoursToDetect: number[];
  medianHours: number | null;
  alerts: number;
  falseAlerts: number;
  alertsPerWeek: number;
  falseAlertsPerWeek: number;
  precision: number;
}

/** Scores alerts against the ground truth. Weeks may be restricted to a range (e.g. test weeks). */
export function evaluate(raw: Alert[], h: History, fromT = 0, toT = h.runs.length): Evaluation {
  const key = (a: Alert) => `${a.scenario}:${a.t}`;
  const alerts = [...new Map(raw.filter((a) => a.t >= fromT && a.t < toT).map((a) => [key(a), a])).values()];
  const eps = h.episodes.filter((e) => e.start >= fromT && e.start < toT);
  const inEpisode = (a: Alert) => h.episodes.some((e) => e.scenario === a.scenario && e.start <= a.t && a.t < e.end);
  const recallByKind = { stable: { detected: 0, total: 0 }, intermittent: { detected: 0, total: 0 }, disguised: { detected: 0, total: 0 } } as Evaluation['recallByKind'];
  const hours: number[] = [];
  for (const e of eps) {
    recallByKind[e.kind].total++;
    const first = alerts.filter((a) => a.scenario === e.scenario && a.t >= e.start && a.t < e.end).sort((a, b) => a.t - b.t)[0];
    if (first) {
      recallByKind[e.kind].detected++;
      hours.push((first.t - e.start) * HOURS_BETWEEN);
    }
  }
  const weeks = (toT - fromT) / 21;
  const falseAlerts = alerts.filter((a) => !inEpisode(a)).length;
  const sorted = [...hours].sort((a, b) => a - b);
  return {
    episodes: eps.length,
    detected: hours.length,
    recall: eps.length ? hours.length / eps.length : 0,
    recallByKind,
    hoursToDetect: hours,
    medianHours: sorted.length ? sorted[Math.floor(sorted.length / 2)]! : null,
    alerts: alerts.length,
    falseAlerts,
    alertsPerWeek: alerts.length / weeks,
    falseAlertsPerWeek: falseAlerts / weeks,
    precision: alerts.length ? (alerts.length - falseAlerts) / alerts.length : 0,
  };
}
