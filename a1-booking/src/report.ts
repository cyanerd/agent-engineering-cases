/**
 * Builds results/summary.md from results/runs-<model>.jsonl.
 * Step 0 uses the free-text runs; steps 1-5 use the strict-schema runs (step 1 = the schema itself).
 * Rates are re-weighted to the setting of the question: a broken layout in 5% of runs (the stand ran 50%).
 * Assumptions (not measured on the stand): a user answers a confirmation in 30 s (15-60 s); each confirmation
 * loses 5% of purchases (2-10%); a cancellation after payment costs the user 3 minutes.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { AgentRun } from './agent.ts';
import type { Intent } from './intent.ts';
import { judgeOrder } from './judge.ts';
import { evaluateLadder, STEPS, type Outcome, type Step } from './ladder.ts';
import type { Layout } from './site/data.ts';
import type { Order } from './site/server.ts';

const BROKEN_SHARE = 0.05;
const HUMAN_SECONDS = { mid: 30, lo: 15, hi: 60 };
const CONVERSION_LOSS = { mid: 0.05, lo: 0.02, hi: 0.1 };
const CANCEL_SECONDS = 180;

type Rec = AgentRun & { model: string; layout: Layout; intent: Intent; cartHtml: string; order: Order };

const dir = new URL('../results/', import.meta.url);
const recs: Rec[] = readdirSync(dir)
  .filter((f) => /^runs-.*\.jsonl$/.test(f))
  .flatMap((f) => readFileSync(new URL(f, dir), 'utf8').trim().split('\n').filter(Boolean).map((l) => ({ model: f.slice(5, -6), ...JSON.parse(l) }) as Rec));

function wilson(k: number, n: number): [number, number] {
  if (n === 0) return [0, 1];
  const z = 1.96, p = k / n, d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d;
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, c - h), Math.min(1, c + h)];
}
const pct = (x: number, digits = 1) => `${(x * 100).toFixed(digits)}%`;
const med = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)]! : 0;
};

const STEP_LABEL: Record<Step, string> = {
  0: '0. Без проверок (свободный текст)',
  1: '1. Строгая схема намерения',
  2: '2. + инварианты без модели',
  3: '3. + независимое чтение корзины',
  4: '4. + подтверждение человека выше 15 000 ₽',
  5: '5. + сверка после оплаты и автоотмена',
};

const md: string[] = [];
for (const model of [...new Set(recs.map((r) => r.model))].sort()) {
  md.push(`## ${model}`, '', `Доли пересчитаны на ${BROKEN_SHARE * 100}% прогонов со сломанной вёрсткой; в скобках - сырые счётчики (основная вёрстка / сломанная) и 95% интервал для сломанной.`, '',
    '| Ступень | Ошибок дошло до пользователя | основная / сломанная | Остановлено с вопросом | Вопросов пользователю всего | Отменено после оплаты | Не дошло до оплаты | Время агента, медиана | + время пользователя на прогон | Потеря конверсии | $ модели на прогон |',
    '|---|---|---|---|---|---|---|---|---|---|---|');
  for (const step of STEPS) {
    const mode = step === 0 ? 'free' : 'schema';
    const rs = recs.filter((r) => r.model === model && r.mode === mode && !r.error);
    const main = rs.filter((r) => r.layout === 'main');
    const broken = rs.filter((r) => r.layout !== 'main');
    if (!main.length || !broken.length) continue;
    const ev = (r: Rec) => evaluateLadder({ intent: r.intent, cartHtml: r.cartHtml, order: r.order, paid: r.paid, mode }, step);
    const rate = (xs: Rec[], f: (r: Rec) => boolean) => xs.filter(f).length / xs.length;
    const weighted = (f: (r: Rec) => boolean) => (1 - BROKEN_SHARE) * rate(main, f) + BROKEN_SHARE * rate(broken, f);
    const is = (o: Outcome) => (r: Rec) => ev(r).outcome === o;
    const asked = (r: Rec) => ev(r).asked;
    const wrongMain = main.filter(is('wrong_paid')).length;
    const wrongBroken = broken.filter(is('wrong_paid')).length;
    const [lo, hi] = wilson(wrongBroken, broken.length);
    const askRate = weighted(asked);
    const cancelRate = weighted(is('cancelled'));
    const userSeconds = askRate * HUMAN_SECONDS.mid + cancelRate * CANCEL_SECONDS;
    md.push(`| ${STEP_LABEL[step]} | ${pct(weighted(is('wrong_paid')), 2)} | ${wrongMain}/${main.length} / ${wrongBroken}/${broken.length} [${pct(lo, 0)}-${pct(hi, 0)}] | ${pct(weighted(is('stopped')))} | ${pct(askRate)} | ${pct(cancelRate)} | ${pct(weighted(is('not_done')))} | ${(med(rs.map((r) => r.agentMs)) / 1000).toFixed(0)} с | ${userSeconds.toFixed(1)} с (${(askRate * HUMAN_SECONDS.lo + cancelRate * CANCEL_SECONDS).toFixed(1)}-${(askRate * HUMAN_SECONDS.hi + cancelRate * CANCEL_SECONDS).toFixed(1)}) | ${pct(askRate * CONVERSION_LOSS.mid, 2)} (${pct(askRate * CONVERSION_LOSS.lo, 2)}-${pct(askRate * CONVERSION_LOSS.hi, 2)}) | ${(rs.reduce((a, r) => a + r.costUsd, 0) / rs.length).toFixed(4)} |`);
  }
  md.push('');
  // Anatomy of wrong orders before any check: which field was wrong, on which layout, with which input.
  const anatomy = new Map<string, Map<string, number>>();
  for (const r of recs.filter((x) => x.model === model && x.paid && !x.error)) {
    const j = judgeOrder(r.order, r.intent);
    if (j.ok) continue;
    const key = `${r.layout}, ${r.mode === 'free' ? 'свободный текст' : 'схема'}`;
    const m = anatomy.get(key) ?? new Map<string, number>();
    for (const p of j.problems) m.set(p, (m.get(p) ?? 0) + 1);
    anatomy.set(key, m);
  }
  if (anatomy.size) {
    md.push('Неверные заказы до проверок - что было не так:', '', '| Вёрстка, вход | Проблемы (поле: число заказов) |', '|---|---|');
    for (const [k, m] of [...anatomy.entries()].sort()) md.push(`| ${k} | ${[...m.entries()].map(([p, n]) => `${p}: ${n}`).join(', ')} |`);
    md.push('');
  }
}
md.push(`Допущения (на стенде не измерить): ответ человека на подтверждение - ${HUMAN_SECONDS.mid} с (${HUMAN_SECONDS.lo}-${HUMAN_SECONDS.hi}); каждый вопрос теряет ${CONVERSION_LOSS.mid * 100}% покупок (${CONVERSION_LOSS.lo * 100}-${CONVERSION_LOSS.hi * 100}%); отмена после оплаты стоит пользователю ${CANCEL_SECONDS / 60} мин.`, '');
writeFileSync(new URL('summary.md', dir), md.join('\n'));
console.log(md.join('\n'));
