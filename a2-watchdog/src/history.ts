import { pick, u } from './rng.ts';

export const RUNS_PER_DAY = 3;
export const HOURS_BETWEEN = 8;
export const RUNS_PER_WEEK = 7 * RUNS_PER_DAY;
export const WEEKS = 4;

export type Cause = 'flake-timeout' | 'flake-data' | 'flake-external' | 'break';
export interface Run {
  scenario: number;
  t: number;
  attempt: number;
  ok: boolean;
  step?: string;
  message?: string;
  cause?: Cause;
}
export interface ScenarioSpec {
  id: number;
  name: string;
  steps: string[];
  flakeRate: number;
  /** Weights of flake causes. */
  causes: Partial<Record<Exclude<Cause, 'break'>, number>>;
  timeoutStep: string;
}
export type EpisodeKind = 'stable' | 'intermittent' | 'disguised';
export interface Episode {
  scenario: number;
  start: number;
  /** Exclusive. */
  end: number;
  kind: EpisodeKind;
  step: string;
  message: string;
}
export interface History {
  seed: number;
  scenarios: ScenarioSpec[];
  episodes: Episode[];
  /** runs[t][scenario] - the scheduled run (attempt 0). */
  runs: Run[][];
  /** Extra attempt k >= 1 of scenario s at time t: sees the same state of the product as the scheduled run. */
  rerun(s: number, t: number, k: number): Run;
}

const NAMES = ['вход по SMS', 'поиск', 'карточка товара', 'корзина', 'оформление', 'оплата картой', 'оплата СБП', 'возврат', 'профиль', 'адреса', 'избранное', 'промокод', 'чат поддержки', 'история заказов', 'уведомления'];
const STEPS = ['open', 'login', 'search', 'select', 'cart', 'checkout', 'pay', 'confirm'];
const FLAKE_RATES = [0.3, 0.25, 0.2, 0.15, 0.15, 0.12, 0.1, 0.06, 0.05, 0.05];
const BREAKS = [
  (r: number) => `TypeError: Cannot read properties of undefined (reading '${pick(['price', 'items', 'id', 'status'], r)}')`,
  (r: number) => `Error: expected status 200, got 500 at POST /api/${pick(['orders', 'cart', 'payments', 'auth/sms'], r)}`,
  (r: number) => `AssertionError: expected "Оплачено" but got "${pick(['Ошибка оплаты', 'Платёж отклонён'], r)}"`,
  (r: number) => `Error: locator('[data-test=${pick(['submit', 'pay', 'next'], r)}]') resolved to 0 elements`,
];

/**
 * Flake messages follow what Playwright actually printed in live/ (results/live-failures.json): a wait shorter
 * than the backend tail, and a read that races the UI. Only the variable parts (timeout, counts) change.
 */
export function timeoutMessage(r1: number, _r2: number): string {
  return `Error: expect(locator).toHaveText(expected) failed\n\nLocator: locator('#status')\nExpected pattern: /Готово/\nReceived string:  "Загрузка…"\nTimeout: ${pick([900, 5000, 10000, 15000], r1)}ms`;
}
function flakeMessage(cause: Exclude<Cause, 'break'>, r1: number, r2: number): string {
  if (cause === 'flake-timeout') return timeoutMessage(r1, r2);
  if (cause === 'flake-data') return `Error: expect(received).toBe(expected) // Object.is equality\n\nExpected: 3\nReceived: ${Math.floor(r1 * 3)}`;
  return `Error: ${pick(['502 Bad Gateway', '503 Service Unavailable', 'ECONNRESET'], r1)} from payments-sandbox (request id ${Math.floor(r2 * 0xffffffff).toString(16)})`;
}

const FAIL_PROB: Record<EpisodeKind, number> = { stable: 0.97, intermittent: 0.5, disguised: 0.9 };
const EPISODE_PLAN: { kind: EpisodeKind; min: number; max: number }[] = [
  ...Array.from({ length: 7 }, () => ({ kind: 'stable' as const, min: 3, max: 6 })),
  ...Array.from({ length: 3 }, () => ({ kind: 'intermittent' as const, min: 6, max: 10 })),
  ...Array.from({ length: 2 }, () => ({ kind: 'disguised' as const, min: 4, max: 8 })),
];

export function generateHistory(seed: number): History {
  const T = WEEKS * RUNS_PER_WEEK;
  const order = Array.from({ length: 30 }, (_, i) => i).sort((a, b) => u(seed, 1, a) - u(seed, 1, b));
  const flaky = new Map(order.slice(0, FLAKE_RATES.length).map((s, i) => [s, FLAKE_RATES[i]!]));
  const scenarios: ScenarioSpec[] = Array.from({ length: 30 }, (_, id) => {
    const steps = STEPS.filter((_, j) => j === 0 || u(seed, 2, id, j) < 0.7);
    const p = flaky.get(id) ?? 0;
    const r = u(seed, 3, id);
    const causes = p === 0 ? {} : r < 0.5 ? { 'flake-timeout': 1 } : r < 0.75 ? { 'flake-timeout': 0.6, 'flake-external': 0.4 } : { 'flake-data': 0.5, 'flake-timeout': 0.5 };
    return { id, name: `${pick(NAMES, u(seed, 4, id))} #${id + 1}`, steps, flakeRate: p, causes, timeoutStep: pick(steps, u(seed, 5, id)) };
  });

  const episodes: Episode[] = [];
  EPISODE_PLAN.forEach((plan, i) => {
    for (let attempt = 0; attempt < 200; attempt++) {
      const candidates = plan.kind === 'disguised' ? scenarios.filter((s) => (s.causes['flake-timeout'] ?? 0) > 0) : scenarios;
      const sc = pick(candidates, u(seed, 6, i, attempt));
      const len = plan.min + Math.floor(u(seed, 7, i, attempt) * (plan.max - plan.min + 1));
      const start = 1 + Math.floor(u(seed, 8, i, attempt) * (T - len - 1));
      if (episodes.some((e) => e.scenario === sc.id && start < e.end + 3 && e.start < start + len + 3)) continue;
      const step = plan.kind === 'disguised' ? sc.timeoutStep : pick(sc.steps, u(seed, 9, i));
      episodes.push({ scenario: sc.id, start, end: start + len, kind: plan.kind, step, message: plan.kind === 'disguised' ? '' : pick(BREAKS, u(seed, 10, i))(u(seed, 11, i)) });
      break;
    }
  });
  episodes.sort((a, b) => a.start - b.start || a.scenario - b.scenario);

  function outcome(s: number, t: number, k: number): Run {
    const sc = scenarios[s]!;
    const ep = episodes.find((e) => e.scenario === s && e.start <= t && t < e.end);
    if (ep) {
      if (u(seed, 20, s, t, k) < FAIL_PROB[ep.kind]) {
        const message = ep.kind === 'disguised' ? timeoutMessage(u(seed, 21, s, t, k), u(seed, 22, s, t, k)) : ep.message;
        return { scenario: s, t, attempt: k, ok: false, step: ep.step, message, cause: 'break' };
      }
      return { scenario: s, t, attempt: k, ok: true };
    }
    if (sc.flakeRate > 0 && u(seed, 30, s, t, k) < sc.flakeRate) {
      const entries = Object.entries(sc.causes) as [Exclude<Cause, 'break'>, number][];
      let r = u(seed, 31, s, t, k) * entries.reduce((a, [, w]) => a + w, 0);
      const cause = entries.find(([, w]) => (r -= w) < 0)?.[0] ?? entries[0]![0];
      const step = cause === 'flake-timeout' ? sc.timeoutStep : cause === 'flake-external' ? 'pay' : 'search';
      return { scenario: s, t, attempt: k, ok: false, step, message: flakeMessage(cause, u(seed, 32, s, t, k), u(seed, 33, s, t, k)), cause };
    }
    return { scenario: s, t, attempt: k, ok: true };
  }

  const runs = Array.from({ length: T }, (_, t) => scenarios.map((sc) => outcome(sc.id, t, 0)));
  return { seed, scenarios, episodes, runs, rerun: outcome };
}
