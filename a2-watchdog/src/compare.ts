/**
 * Tunes each mechanism on weeks 1-2 (train) of 20 seeded histories, then compares them on weeks 3-4 (test).
 * Writes results/summary.md and results/summary.json.
 * Cost used for tuning, fixed before looking at test: a missed real breakage = 10 false alerts.
 */
import { writeFileSync } from 'node:fs';
import { anyFailure, fingerprints, rerun, windowStats, type Detector } from './detectors.ts';
import { evaluate, type Alert, type Evaluation } from './evaluate.ts';
import { generateHistory, RUNS_PER_WEEK, type EpisodeKind, type History } from './history.ts';

const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);
const TRAIN: [number, number] = [0, 2 * RUNS_PER_WEEK];
const TEST: [number, number] = [2 * RUNS_PER_WEEK, 4 * RUNS_PER_WEEK];
const MISS_COST = 10;

interface Candidate {
  mechanism: string;
  label: string;
  make: (phase: 'train' | 'test') => Detector;
}

const union = (a: Detector, b: Detector): Detector => (h) => {
  const x = a(h);
  const y = b(h);
  return { alerts: [...x.alerts, ...y.alerts], extraRuns: x.extraRuns + y.extraRuns };
};

const candidates: Candidate[] = [
  { mechanism: 'База: красный на любой сбой', label: '-', make: () => anyFailure() },
  ...[1, 2, 3].flatMap((k) =>
    [undefined, { rate: 0.1, window: 21 }, { rate: 0.2, window: 21 }].map((q) => ({
      mechanism: '1. Перепрогон + карантин',
      label: `k=${k}${q ? `, карантин при ≥${q.rate * 100}% мигания за неделю` : ', без карантина'}`,
      make: () => rerun({ k, ...(q ? { quarantine: q } : {}) }),
    })),
  ),
  ...[1.5, 2, 2.5, 3, 4, 5].map((threshold) => ({
    mechanism: '2. Статистика по окну (CUSUM)',
    label: `порог ${threshold}`,
    make: () => windowStats({ threshold }),
  })),
  {
    mechanism: '3. Отпечатки сбоев',
    label: 'новая сигнатура = сигнал',
    make: (phase: 'train' | 'test') => fingerprints({ warmupUntil: phase === 'test' ? TEST[0] : 0 }),
  },
  ...[2, 3, 4].map((threshold) => ({
    mechanism: '3 + 2. Отпечатки + статистика',
    label: `CUSUM порог ${threshold}`,
    make: (phase: 'train' | 'test') => union(fingerprints({ warmupUntil: phase === 'test' ? TEST[0] : 0 }), windowStats({ threshold })),
  })),
];

const histories: History[] = SEEDS.map(generateHistory);
const weeks = (r: [number, number]) => (r[1] - r[0]) / RUNS_PER_WEEK;

function run(c: Candidate, phase: 'train' | 'test') {
  const range = phase === 'train' ? TRAIN : TEST;
  return histories.map((h) => {
    const out = c.make(phase)(h);
    // Extra runs counted only inside the range.
    const ev = evaluate(out.alerts as Alert[], h, range[0], range[1]);
    return { ev, extraPerWeek: out.extraRuns / (h.runs.length / RUNS_PER_WEEK) };
  });
}

const cost = (rs: { ev: Evaluation }[], range: [number, number]) =>
  rs.reduce((s, r) => s + r.ev.falseAlertsPerWeek + (MISS_COST * (r.ev.episodes - r.ev.detected)) / weeks(range), 0) / rs.length;

const med = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)]! : NaN;
};
const q = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
};

// Tune: best label per mechanism on train.
const byMechanism = new Map<string, { c: Candidate; trainCost: number }>();
const grid: { mechanism: string; label: string; trainCost: number }[] = [];
for (const c of candidates) {
  const trainCost = cost(run(c, 'train'), TRAIN);
  grid.push({ mechanism: c.mechanism, label: c.label, trainCost });
  const cur = byMechanism.get(c.mechanism);
  if (!cur || trainCost < cur.trainCost) byMechanism.set(c.mechanism, { c, trainCost });
}

interface Row {
  mechanism: string;
  label: string;
  recall: number;
  recallByKind: Record<EpisodeKind, string>;
  medianHours: number;
  falsePerWeekMed: number;
  falsePerWeekP10: number;
  falsePerWeekP90: number;
  alertsPerWeek: number;
  extraRunsPerWeek: number;
  testCost: number;
}

const rows: Row[] = [...byMechanism.values()].map(({ c }) => {
  const rs = run(c, 'test');
  const kinds: EpisodeKind[] = ['stable', 'intermittent', 'disguised'];
  const recallByKind = Object.fromEntries(
    kinds.map((k) => {
      const d = rs.reduce((s, r) => s + r.ev.recallByKind[k].detected, 0);
      const t = rs.reduce((s, r) => s + r.ev.recallByKind[k].total, 0);
      return [k, `${d}/${t}`];
    }),
  ) as Record<EpisodeKind, string>;
  const det = rs.reduce((s, r) => s + r.ev.detected, 0);
  const eps = rs.reduce((s, r) => s + r.ev.episodes, 0);
  return {
    mechanism: c.mechanism,
    label: c.label,
    recall: eps ? det / eps : 0,
    recallByKind,
    medianHours: med(rs.flatMap((r) => r.ev.hoursToDetect)),
    falsePerWeekMed: med(rs.map((r) => r.ev.falseAlertsPerWeek)),
    falsePerWeekP10: q(rs.map((r) => r.ev.falseAlertsPerWeek), 0.1),
    falsePerWeekP90: q(rs.map((r) => r.ev.falseAlertsPerWeek), 0.9),
    alertsPerWeek: med(rs.map((r) => r.ev.alertsPerWeek)),
    extraRunsPerWeek: med(rs.map((r) => r.extraPerWeek)),
    testCost: cost(rs, TEST),
  };
});

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
const md = [
  '## Сравнение на неделях 3-4 (20 историй, параметры подобраны на неделях 1-2)',
  '',
  `Цена для подбора и итоговой колонки: ложный сигнал = 1, пропущенная настоящая поломка = ${MISS_COST} (в неделю, на одну историю).`,
  '',
  '| Механика | Параметры (подобраны на train) | Найдено поломок | стабильные / перемежающиеся / замаскированные | Медиана часов до сигнала | Ложных сигналов в неделю, медиана [10%-90%] | Сигналов в неделю | Лишних прогонов в неделю | Цена |',
  '|---|---|---|---|---|---|---|---|---|',
  ...rows.map((r) => `| ${r.mechanism} | ${r.label} | ${pct(r.recall)} | ${r.recallByKind.stable} / ${r.recallByKind.intermittent} / ${r.recallByKind.disguised} | ${Number.isNaN(r.medianHours) ? '-' : r.medianHours} | ${r.falsePerWeekMed.toFixed(1)} [${r.falsePerWeekP10.toFixed(1)}-${r.falsePerWeekP90.toFixed(1)}] | ${r.alertsPerWeek.toFixed(1)} | ${r.extraRunsPerWeek.toFixed(1)} | ${r.testCost.toFixed(1)} |`),
  '',
  '## Все конфигурации на train',
  '',
  '| Механика | Параметры | Цена на train |',
  '|---|---|---|',
  ...grid.map((g) => `| ${g.mechanism} | ${g.label} | ${g.trainCost.toFixed(1)} |`),
  '',
];
writeFileSync(new URL('../results/summary.md', import.meta.url), md.join('\n'));
writeFileSync(new URL('../results/summary.json', import.meta.url), `${JSON.stringify({ rows, grid }, null, 2)}\n`);
console.log(md.slice(0, rows.length + 6).join('\n'));
