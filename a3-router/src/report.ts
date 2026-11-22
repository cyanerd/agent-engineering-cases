/**
 * Builds results/summary.md, results/policies.csv and results/frontier.svg from results/answers.jsonl
 * (cheap tier qwen3:8b-nothink; A3_CHEAP=qwen3:8b writes the -qwen3_8b variants for the thinking tier).
 * Everything that is tuned (type rule, cascade configuration) is chosen on train; test is used once.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import type { AnswerRow } from './run.ts';
import { agreement, allCheap, allExpensive, buildTable, byType, cascade, evaluate, learnTypeRule, type CascadeConfig, type Entry } from './router.ts';
import { pairedBootstrap, shadowPower } from './stats.ts';
import { loadTasks, type TaskType } from './tasks/index.ts';

const DEFAULT_CHEAP = 'qwen3:8b-nothink';
const CHEAP = process.env.A3_CHEAP ?? DEFAULT_CHEAP;
/** Another cheap tier writes its own files: summary-<model>.md etc. */
const SUFFIX = CHEAP === DEFAULT_CHEAP ? '' : `-${CHEAP.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
const EXPENSIVE = process.env.A3_EXPENSIVE ?? 'deepseek-v4-pro';
/** Non-inferiority margin, fixed before looking at test. */
const DELTA = 0.02;
/** Working point rule on train: cheapest configuration within this distance of all-expensive. */
const TRAIN_SLACK = 0.01;
const TYPES: TaskType[] = ['classify', 'extract', 'math', 'qa'];

const dir = new URL('../results/', import.meta.url);
const rows: AnswerRow[] = readFileSync(new URL('answers.jsonl', dir), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const tasks = loadTasks();
const table = buildTable(tasks, rows, CHEAP, EXPENSIVE);
const train = table.filter((e) => e.task.split === 'train');
const test = table.filter((e) => e.task.split === 'test');
const mean = (xs: number[]) => xs.reduce((a, x) => a + x, 0) / Math.max(1, xs.length);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const md: string[] = [];

// 1. Where the cheap model is worse: greedy accuracy per model and type, all tasks.
const models = [...new Set(rows.map((r) => r.model))].sort();
md.push('## Точность моделей по типам задач (жадный ответ, все 480 задач)', '', `| Модель | ${TYPES.join(' | ')} | Все | Ошибки API |`, `|---|${TYPES.map(() => '---').join('|')}|---|---|`);
for (const m of models) {
  const greedy = rows.filter((r) => r.model === m && r.sample === 0);
  const ok = greedy.filter((r) => !r.error);
  const cell = (t?: TaskType) => {
    const xs = ok.filter((r) => !t || r.type === t);
    return xs.length ? `${pct(xs.filter((r) => r.correct).length / xs.length)} (${xs.length})` : '-';
  };
  md.push(`| ${m} | ${TYPES.map(cell).join(' | ')} | ${cell()} | ${greedy.length - ok.length} |`);
}
md.push('', `Дальше: дешёвая = \`${CHEAP}\` (3 сэмпла), дорогая = \`${EXPENSIVE}\`. Задач в таблице маршрутизации: train ${train.length}, test ${test.length} (задачи с ошибкой API у любой из моделей исключены для всех политик).`, '');

// 2. Policies. Cascade grid evaluated on train.
const subsets: TaskType[][] = [[]];
for (const t of TYPES) subsets.push(...subsets.map((s) => [...s, t]));
const grid: CascadeConfig[] = [];
for (const requireValidJson of [false, true]) for (const minAgreement of [1, 2, 3] as const) for (const typesToExpensive of subsets) grid.push({ requireValidJson, minAgreement, typesToExpensive });
const label = (c: CascadeConfig) => `cascade(json=${c.requireValidJson ? 'да' : 'нет'}, согласие≥${c.minAgreement}${c.typesToExpensive?.length ? `, всегда дорогая: ${c.typesToExpensive.join('+')}` : ''})`;
const samplesUsed = (c: CascadeConfig) => (c.minAgreement > 1 ? 3 : 1);

const expTrain = evaluate(allExpensive, train, 0);
const scored = grid.map((c) => ({ c, tr: evaluate(cascade(c), train, samplesUsed(c)), te: evaluate(cascade(c), test, samplesUsed(c)) }));
const eligible = scored.filter((s) => s.tr.accuracy >= expTrain.accuracy - TRAIN_SLACK).sort((a, b) => a.tr.expensiveShare - b.tr.expensiveShare || b.tr.accuracy - a.tr.accuracy);
const chosen = eligible[0];
const rule = learnTypeRule(train, DELTA);

const policies: { name: string; tr: ReturnType<typeof evaluate>; te: ReturnType<typeof evaluate> }[] = [
  { name: 'всё на дешёвую', tr: evaluate(allCheap, train), te: evaluate(allCheap, test) },
  { name: 'всё на дорогую', tr: expTrain, te: evaluate(allExpensive, test, 0) },
  { name: `правило по типу (${TYPES.map((t) => `${t}→${rule[t] === 'cheap' ? 'дешёвая' : 'дорогая'}`).join(', ')})`, tr: evaluate(byType(rule), train), te: evaluate(byType(rule), test) },
  ...(chosen ? [{ name: `**выбранный каскад**: ${label(chosen.c)}`, tr: chosen.tr, te: chosen.te }] : []),
];
md.push('## Политики маршрутизации', '', 'Правило по типу и конфигурация каскада выбраны на train; test посчитан один раз. Стоимость локальной модели - $0 (предельная; железо и электричество не считаются).', '',
  '| Политика | Точность train | Точность test | Доля на дорогую (test) | $ на 1000 запросов (test) | p50 задержки (test) |', '|---|---|---|---|---|---|',
  ...policies.map((p) => `| ${p.name} | ${pct(p.tr.accuracy)} | ${pct(p.te.accuracy)} | ${pct(p.te.expensiveShare)} | ${p.te.costPer1000Usd.toFixed(3)} | ${(p.te.p50LatencyMs / 1000).toFixed(1)} с |`), '');

// 3. Non-inferiority of the chosen cascade vs all-expensive on test.
if (chosen) {
  const b = pairedBootstrap(chosen.te.correct, evaluate(allExpensive, test, 0).correct);
  const verdict = b.lo > -DELTA ? `**не хуже** «всё на дорогую» с маржой ${DELTA * 100} п.п.` : `**не доказано**, что не хуже: нижняя граница ниже −${DELTA * 100} п.п.`;
  md.push('## Не-худшесть выбранного каскада (test, парный бутстреп, 10 000 повторов)', '',
    `Разница точности «каскад − всё на дорогую»: ${(b.diff * 100).toFixed(1)} п.п., 95% интервал [${(b.lo * 100).toFixed(1)}; ${(b.hi * 100).toFixed(1)}] п.п. Маржа задана заранее: −${DELTA * 100} п.п. Вывод: ${verdict}.`,
    `Цена: ${chosen.te.costPer1000Usd.toFixed(3)} $ на 1000 запросов против ${evaluate(allExpensive, test, 0).costPer1000Usd.toFixed(3)} $ у «всё на дорогую»; на дорогую уходит ${pct(chosen.te.expensiveShare)} запросов.`, '');

  // 4. Confidently wrong: all cheap samples agree and are wrong - the floor of any self-consistency cascade.
  const confWrong = (es: Entry[]) => es.filter((e) => agreement(e) === 3 && !e.cheap[0]!.correct).length;
  md.push(`Предел каскада по согласию: в test ${confWrong(test)} из ${test.length} задач (${pct(confWrong(test) / test.length)}) дешёвая модель ответила одинаково неверно во всех трёх сэмплах - такие ошибки никакой порог согласия не поймает.`, '');

  // 5. Shadow mode, simulated on test pairs with the same decision rule as offline (two-sided 95%, margin DELTA).
  const d = chosen.te.correct.map((x, i) => Number(x) - Number(evaluate(allExpensive, test, 0).correct[i]));
  // "No real difference": the same number of disagreements, split evenly between the two sides.
  const disc = d.filter((x) => x !== 0).length;
  const even = [...d.filter((x) => x === 0), ...Array.from({ length: disc }, (_, i) => (i % 2 ? 1 : -1))];
  const NS = [130, 240, 500, 1000, 2000, 4000];
  const obs = NS.map((n) => shadowPower(d, n, DELTA));
  const zero = NS.map((n) => shadowPower(even, n, DELTA));
  const need = NS.find((_, i) => obs[i]! >= 0.8);
  md.push('## Теневой режим в проде (симуляция на test)', '',
    `Доля запросов роутера параллельно уходит к дорогой модели, ответы сравниваются. Симуляция: n теневых сравнений вытягиваются из парных разниц test, решение - то же, что офлайн (нижняя граница 95% интервала выше −${DELTA * 100} п.п.). Вероятность доказать не-худшесть:`, '',
    `| Сравнений в тени | ${NS.join(' | ')} |`, `|---|${NS.map(() => '---').join('|')}|`,
    `| если роутер хуже, как на test (${(mean(d) * 100).toFixed(1)} п.п.) | ${obs.map((p) => pct(p)).join(' | ')} |`,
    `| если разницы нет (расхождений столько же - ${disc}, поровну в обе стороны) | ${zero.map((p) => pct(p)).join(' | ')} |`, '',
    need ? `С мощностью 80% при наблюдаемой разнице нужно около **${need}** сравнений; при 10% тени - ${need * 10} запросов роутера.` : 'Мощности 80% при наблюдаемой разнице не достигнуто даже на 4000 сравнений.', '');
}

// 6. Frontier: every cascade configuration, train vs test.
const csv = ['config,train_accuracy,train_expensive_share,test_accuracy,test_expensive_share,test_cost_per_1000_usd', ...scored.map((s) => [JSON.stringify(label(s.c)), s.tr.accuracy, s.tr.expensiveShare, s.te.accuracy, s.te.expensiveShare, s.te.costPer1000Usd].join(','))];
writeFileSync(new URL(`policies${SUFFIX}.csv`, dir), `${csv.join('\n')}\n`);

const W = 640, H = 360, P = 48;
const x = (share: number) => P + share * (W - 2 * P);
const allAcc = scored.flatMap((s) => [s.tr.accuracy, s.te.accuracy]).concat(policies.map((p) => p.te.accuracy));
const yMin = Math.floor(Math.min(...allAcc) * 20) / 20, yMax = Math.min(1, Math.ceil(Math.max(...allAcc) * 20) / 20);
const y = (a: number) => H - P - ((a - yMin) / Math.max(0.05, yMax - yMin)) * (H - 2 * P);
const dots = scored.map((s) => `<circle cx="${x(s.te.expensiveShare).toFixed(1)}" cy="${y(s.te.accuracy).toFixed(1)}" r="3" fill="#7a8ca5" opacity="0.6"/>`).join('');
const marks = policies.map((p, i) => `<circle cx="${x(p.te.expensiveShare).toFixed(1)}" cy="${y(p.te.accuracy).toFixed(1)}" r="6" fill="${['#c0392b', '#1f6feb', '#8e44ad', '#16a34a'][i]}"/><text x="${(x(p.te.expensiveShare) + 8).toFixed(1)}" y="${(y(p.te.accuracy) - 8).toFixed(1)}" font-size="11" fill="#222">${['всё дешёвая', 'всё дорогая', 'по типу', 'каскад'][i]}</text>`).join('');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="sans-serif"><rect width="100%" height="100%" fill="#fff"/>
<line x1="${P}" y1="${H - P}" x2="${W - P}" y2="${H - P}" stroke="#444"/><line x1="${P}" y1="${P}" x2="${P}" y2="${H - P}" stroke="#444"/>
<text x="${W / 2}" y="${H - 12}" font-size="12" text-anchor="middle">доля запросов на дорогую модель (test)</text>
<text x="14" y="${H / 2}" font-size="12" text-anchor="middle" transform="rotate(-90 14 ${H / 2})">точность (test)</text>
<text x="${P}" y="${H - P + 16}" font-size="10" text-anchor="middle">0%</text><text x="${W - P}" y="${H - P + 16}" font-size="10" text-anchor="middle">100%</text>
<text x="${P - 6}" y="${y(yMin) + 4}" font-size="10" text-anchor="end">${pct(yMin)}</text><text x="${P - 6}" y="${y(yMax) + 4}" font-size="10" text-anchor="end">${pct(yMax)}</text>
${dots}${marks}</svg>`;
writeFileSync(new URL(`frontier${SUFFIX}.svg`, dir), svg);
md.push('## Кривая «доля на дорогую → качество»', '', `Серые точки - все ${grid.length} конфигураций каскада на test; цветные - политики из таблицы. Файл: \`results/frontier${SUFFIX}.svg\`, все точки - \`results/policies${SUFFIX}.csv\`.`, '', `![frontier](frontier${SUFFIX}.svg)`, '');

writeFileSync(new URL(`summary${SUFFIX}.md`, dir), md.join('\n'));
console.log(md.join('\n'));
