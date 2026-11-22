/**
 * Tunes each mechanism on weeks 1-2 (train) of 20 seeded histories, then compares them on weeks 3-4 (test).
 * Writes results/summary.md and results/summary.json.
 * Cost used for tuning, fixed before looking at test: a false alert = 1, a missed real breakage = 10,
 * an extra (rerun) run = 0.05 (20 reruns ~ one false alert). The cost without the run term is shown too.
 */
import { writeFileSync } from 'node:fs';
import { anyFailure, fingerprints, fingerprintsThenRerun, rerun, windowStats, type Detector } from './detectors.ts';
import { pairedDiff } from './paired.ts';
import { evaluate, type Alert, type Evaluation } from './evaluate.ts';
import { generateHistory, RUNS_PER_WEEK, type EpisodeKind, type History, type HistoryOptions } from './history.ts';

const SEEDS = Array.from({ length: 100 }, (_, i) => i + 1);
const TRAIN: [number, number] = [0, 2 * RUNS_PER_WEEK];
const TEST: [number, number] = [2 * RUNS_PER_WEEK, 4 * RUNS_PER_WEEK];
const MISS_COST = 10;
const RUN_COST = 0.05;

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
  ...[1.5, 2, 2.5, 3, 4, 5, 6].map((threshold) => ({
    mechanism: '2. Статистика по окну (CUSUM)',
    label: `порог ${threshold}`,
    make: () => windowStats({ threshold }),
  })),
  {
    mechanism: '3. Отпечатки сбоев',
    label: 'новая сигнатура = сигнал',
    make: (phase: 'train' | 'test') => fingerprints({ warmupUntil: phase === 'test' ? TEST[0] : 0 }),
  },
  ...[2, 3, 4, 5, 6].map((threshold) => ({
    mechanism: '3 + 2. Отпечатки + статистика',
    label: `CUSUM порог ${threshold}`,
    make: (phase: 'train' | 'test') => union(fingerprints({ warmupUntil: phase === 'test' ? TEST[0] : 0 }), windowStats({ threshold })),
  })),
  ...[1, 2, 3].map((k) => ({
    mechanism: '3 + 1. Отпечатки, знакомые - перепрогон',
    label: `k=${k}`,
    make: (phase: 'train' | 'test') => fingerprintsThenRerun({ k, warmupUntil: phase === 'test' ? TEST[0] : 0 }),
  })),
  ...[1, 2].flatMap((k) =>
    [3, 4, 5, 6].map((threshold) => ({
      mechanism: '1 + 2. Перепрогон + статистика',
      label: `k=${k}, CUSUM порог ${threshold}`,
      make: () => union(rerun({ k }), windowStats({ threshold })),
    })),
  ),
];

let histories: History[] = SEEDS.map((s) => generateHistory(s));
const weeks = (r: [number, number]) => (r[1] - r[0]) / RUNS_PER_WEEK;

function run(c: Candidate, phase: 'train' | 'test') {
  const range = phase === 'train' ? TRAIN : TEST;
  return histories.map((h) => {
    const out = c.make(phase)(h);
    // Extra runs: the detector's total over 4 weeks, per week (reruns happen evenly over time).
    const ev = evaluate(out.alerts as Alert[], h, range[0], range[1]);
    return { ev, extraPerWeek: out.extraRuns / (h.runs.length / RUNS_PER_WEEK) };
  });
}

const costOne = (r: { ev: Evaluation; extraPerWeek: number }, range: [number, number], withRuns = true) =>
  r.ev.falseAlertsPerWeek + (MISS_COST * (r.ev.episodes - r.ev.detected)) / weeks(range) + (withRuns ? RUN_COST * r.extraPerWeek : 0);
const cost = (rs: { ev: Evaluation; extraPerWeek: number }[], range: [number, number], withRuns = true) =>
  rs.reduce((s, r) => s + costOne(r, range, withRuns), 0) / rs.length;

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
  extraRunsMean: number;
  testCost: number;
  testCostP10: number;
  testCostP90: number;
  testCostNoRuns: number;
}

const rows: Row[] = [...byMechanism.values()].map(({ c }) => {
  const rs = run(c, 'test');
  const kinds: EpisodeKind[] = ['stable', 'intermittent', 'disguised', 'degradation'];
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
    extraRunsMean: rs.reduce((s, r) => s + r.extraPerWeek, 0) / rs.length,
    testCost: cost(rs, TEST),
    testCostP10: q(rs.map((r) => costOne(r, TEST)), 0.1),
    testCostP90: q(rs.map((r) => costOne(r, TEST)), 0.9),
    testCostNoRuns: cost(rs, TEST, false),
  };
});

// Paired check of the two leading mechanisms, per history, on the base seeds and on 100 new seeds never used
// for tuning. Total cost at the tuning run cost, and the cost without runs (false alerts + misses only).
const A_NAME = '1 + 2. Перепрогон + статистика';
const B_NAME = '3 + 2. Отпечатки + статистика';
const lead = (name: string) => byMechanism.get(name)!;
const NEW_SEEDS = Array.from({ length: 100 }, (_, i) => i + 1001);
const pairedOn = (seeds: number[], label: string) => {
  histories = seeds.map((s) => generateHistory(s));
  const ra = run(lead(A_NAME).c, 'test');
  const rb = run(lead(B_NAME).c, 'test');
  const extra = ra.reduce((x, r) => x + r.extraPerWeek, 0) / ra.length - rb.reduce((x, r) => x + r.extraPerWeek, 0) / rb.length;
  const withRuns = pairedDiff(ra.map((r) => costOne(r, TEST)), rb.map((r) => costOne(r, TEST)));
  const noRuns = pairedDiff(ra.map((r) => costOne(r, TEST, false)), rb.map((r) => costOne(r, TEST, false)));
  return { label, withRuns, noRuns, extraRunsDiff: extra, breakEven: -noRuns.mean / extra, breakEvenRange: [-(noRuns.mean + noRuns.half) / extra, -(noRuns.mean - noRuns.half) / extra] };
};
const paired = [pairedOn(SEEDS, 'истории 1-100 (основные)'), pairedOn(NEW_SEEDS, 'истории 1001-1100 (новые)')];
histories = SEEDS.map((s) => generateHistory(s));

// Sensitivity: the tuned parameters, other mixes of breakage. Which mechanism has the lowest test cost?
const chosen = [...byMechanism.values()].filter(({ c }) => !c.mechanism.startsWith('База'));
const sweeps: { label: string; opts: HistoryOptions }[] = [
  { label: 'базовый состав', opts: {} },
  { label: 'без замаскированных', opts: { disguised: 0 } },
  { label: 'замаскированных вдвое больше', opts: { disguised: 4 } },
  { label: 'без деградаций', opts: { degradation: 0 } },
  { label: 'деградаций вдвое больше', opts: { degradation: 4 } },
  { label: 'перемежающиеся падают в 30%', opts: { intermittentFail: 0.3 } },
  { label: 'перемежающиеся падают в 70%', opts: { intermittentFail: 0.7 } },
];
const sensitivity = sweeps.map((sw) => {
  histories = SEEDS.map((seed) => generateHistory(seed, sw.opts));
  const costs = chosen.map(({ c }) => ({ mechanism: c.mechanism, cost: cost(run(c, 'test'), TEST) }));
  return { label: sw.label, costs };
});

// Run-cost sensitivity: the same tuned detectors, cost = cost without runs + c * mean extra runs per week.
const RUN_COSTS = [0, 0.01, 0.02, 0.05, 0.1, 0.2];
const contenders = rows.filter((r) => !r.mechanism.startsWith('База'));
const runCostRows = RUN_COSTS.map((c) => {
  const costs = contenders.map((r) => ({ mechanism: r.mechanism, cost: r.testCostNoRuns + c * r.extraRunsMean }));
  return { c, costs, best: [...costs].sort((a, b) => a.cost - b.cost)[0]!.mechanism };
});
const SCHEDULED_PER_WEEK = histories[0]!.scenarios.length * RUNS_PER_WEEK;

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
const md = [
  '## Сравнение на неделях 3-4 (100 историй, параметры подобраны на неделях 1-2)',
  '',
  `Цена для подбора и итоговой колонки: ложный сигнал = 1, пропущенная настоящая поломка = ${MISS_COST}, лишний прогон = ${RUN_COST} (в неделю, на одну историю).`,
  '',
  '| Механика | Параметры (подобраны на train) | Найдено поломок | стабильные / перемежающиеся / замаскированные / деградации | Медиана часов до сигнала | Ложных сигналов в неделю, медиана [10%-90%] | Лишних прогонов в неделю | Цена [10%-90%] | Цена без учёта прогонов |',
  '|---|---|---|---|---|---|---|---|---|',
  ...rows.map((r) => `| ${r.mechanism} | ${r.label} | ${pct(r.recall)} | ${r.recallByKind.stable} / ${r.recallByKind.intermittent} / ${r.recallByKind.disguised} / ${r.recallByKind.degradation} | ${Number.isNaN(r.medianHours) ? '-' : r.medianHours} | ${r.falsePerWeekMed.toFixed(1)} [${r.falsePerWeekP10.toFixed(1)}-${r.falsePerWeekP90.toFixed(1)}] | ${r.extraRunsPerWeek.toFixed(1)} | ${r.testCost.toFixed(1)} [${r.testCostP10.toFixed(1)}-${r.testCostP90.toFixed(1)}] | ${r.testCostNoRuns.toFixed(1)} |`),
  '',
  `Плановых прогонов в неделю: ${SCHEDULED_PER_WEEK}. Лишние прогоны в процентах от плановых: ${contenders.filter((r) => r.extraRunsMean > 0).map((r) => `${r.mechanism} - ${((100 * r.extraRunsMean) / SCHEDULED_PER_WEEK).toFixed(1)}%`).join('; ')}.`,
  '',
  '## Чувствительность к цене прогона (параметры подобраны при цене 0.05, цена ложного сигнала = 1)',
  '',
  `| Цена прогона | ${contenders.map((r) => r.mechanism).join(' | ')} | Лучшая |`,
  `|---|${contenders.map(() => '---').join('|')}|---|`,
  ...runCostRows.map((x) => `| ${x.c} | ${x.costs.map((c) => c.cost.toFixed(1)).join(' | ')} | ${x.best} |`),
  '',
  `## «1 + 2» против «3 + 2» парно, по историям (цена на неделях 3-4; на train: ${lead(A_NAME).trainCost.toFixed(1)} против ${lead(B_NAME).trainCost.toFixed(1)})`,
  '',
  '| Истории | Разница цены при прогоне 0.05, среднее ± 95% | «1 + 2» дешевле, историй | Разница без учёта прогонов (ложные + пропуски) | Лишних прогонов в неделю у «1 + 2» сверх «3 + 2» | Точка безразличия: цена прогона [95%] |',
  '|---|---|---|---|---|---|',
  ...paired.map((x) => `| ${x.label} | ${x.withRuns.mean.toFixed(2)} ± ${x.withRuns.half.toFixed(2)} | ${x.withRuns.aWins}/100 | ${x.noRuns.mean.toFixed(2)} ± ${x.noRuns.half.toFixed(2)} | ${x.extraRunsDiff.toFixed(1)} | ${x.breakEven.toFixed(3)} [${x.breakEvenRange[0]!.toFixed(3)}-${x.breakEvenRange[1]!.toFixed(3)}] |`),
  '',
  '## Чувствительность к составу поломок (параметры подобраны на базовом составе, цена на test)',
  '',
  `| Состав | ${chosen.map(({ c }) => c.mechanism).join(' | ')} | Лучшая |`,
  `|---|${chosen.map(() => '---').join('|')}|---|`,
  ...sensitivity.map((sv) => {
    const best = [...sv.costs].sort((a, b) => a.cost - b.cost)[0]!;
    return `| ${sv.label} | ${sv.costs.map((c) => c.cost.toFixed(1)).join(' | ')} | ${best.mechanism} |`;
  }),
  '',
  '## Все конфигурации на train',
  '',
  '| Механика | Параметры | Цена на train |',
  '|---|---|---|',
  ...grid.map((g) => `| ${g.mechanism} | ${g.label} | ${g.trainCost.toFixed(1)} |`),
  '',
];
writeFileSync(new URL('../results/summary.md', import.meta.url), md.join('\n'));
writeFileSync(new URL('../results/summary.json', import.meta.url), `${JSON.stringify({ rows, grid, sensitivity, runCostRows, paired }, null, 2)}\n`);
console.log(md.slice(0, rows.length + 16).join('\n'));
