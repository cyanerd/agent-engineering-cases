import { describe, expect, it } from 'vitest';
import type { AnswerRow } from '../src/run.ts';
import { allCheap, allExpensive, buildTable, byType, canonical, cascade, evaluate, learnTypeRule } from '../src/router.ts';
import type { Task } from '../src/tasks/types.ts';

const task = (id: string, type: Task['type'], split: Task['split'] = 'test', answer: unknown = 4): Task => ({ id, type, prompt: 'x'.repeat(30), answer, split });
const row = (t: Task, model: string, sample: number, output: string, correct: boolean, costUsd = 0): AnswerRow => ({
  taskId: t.id, type: t.type, split: t.split, model, sample, output, correct, inputTokens: 1, outputTokens: 1, costUsd, latencyMs: 100,
});
const CHEAP = 'small';
const BIG = 'big';
const ex = { customer: 'A B', date: '2026-01-01', amount: 1, currency: 'RUB', items: 1 };

const tm = task('math-1', 'math');
const te = task('extract-1', 'extract', 'test', ex);
const rows: AnswerRow[] = [
  // math: cheap samples disagree (4, 4, 5), cheap greedy right; big right
  row(tm, CHEAP, 0, '#### 4', true), row(tm, CHEAP, 1, 'answer 4', true), row(tm, CHEAP, 2, '5', false), row(tm, BIG, 0, '#### 4', true, 0.01),
  // extract: cheap output invalid JSON; big right
  row(te, CHEAP, 0, 'not json', false), row(te, CHEAP, 1, 'not json', false), row(te, CHEAP, 2, 'not json', false), row(te, BIG, 0, JSON.stringify(ex), true, 0.02),
];
const table = buildTable([tm, te], rows, CHEAP, BIG);

describe('canonical', () => {
  it('normalises numbers, labels and JSON so agreement compares meaning', () => {
    expect(canonical(tm, '#### 4')).toBe(canonical(tm, 'The answer is 4.0'));
    expect(canonical(te, JSON.stringify(ex))).toBe(canonical(te, `\`\`\`json\n${JSON.stringify({ ...ex, amount: '1,00' })}\n\`\`\``));
  });
});

describe('policies', () => {
  it('allExpensive: share 1, accuracy of the big model, its cost per 1000', () => {
    const r = evaluate(allExpensive, table);
    expect(r).toMatchObject({ accuracy: 1, expensiveShare: 1 });
    expect(r.costPer1000Usd).toBeCloseTo(((0.01 + 0.02) / 2) * 1000, 6);
  });
  it('allCheap: share 0, greedy cheap accuracy, zero cost', () => {
    expect(evaluate(allCheap, table)).toMatchObject({ accuracy: 0.5, expensiveShare: 0, costPer1000Usd: 0 });
  });
  it('cascade escalates on disagreement below the threshold and on invalid JSON', () => {
    expect(evaluate(cascade({ requireValidJson: true, minAgreement: 2 }), table)).toMatchObject({ accuracy: 1, expensiveShare: 0.5 });
    expect(evaluate(cascade({ requireValidJson: true, minAgreement: 3 }), table)).toMatchObject({ accuracy: 1, expensiveShare: 1 });
    // An answer with no extractable meaning (no JSON, no number) has agreement 0 and is never trusted.
    expect(evaluate(cascade({ requireValidJson: false, minAgreement: 1 }), table)).toMatchObject({ accuracy: 1, expensiveShare: 0.5 });
  });
  it('byType routes whole types', () => {
    expect(evaluate(byType({ math: 'cheap', extract: 'expensive', classify: 'cheap', qa: 'cheap' }), table)).toMatchObject({ accuracy: 1, expensiveShare: 0.5 });
  });
  it('learnTypeRule uses train rows only and keeps cheap when it is within delta', () => {
    const tr = task('math-2', 'math', 'train');
    const trainRows = [row(tr, CHEAP, 0, '4', true), row(tr, CHEAP, 1, '4', true), row(tr, CHEAP, 2, '4', true), row(tr, BIG, 0, '4', true)];
    const rule = learnTypeRule(buildTable([tr, tm, te], [...rows, ...trainRows], CHEAP, BIG).filter((x) => x.task.split === 'train'), 0.02);
    expect(rule.math).toBe('cheap');
  });
  it('tasks with a model error are dropped from the table for every policy', () => {
    const t3 = task('qa-1', 'qa');
    const bad = [row(t3, CHEAP, 0, '4', true), row(t3, CHEAP, 1, '4', true), row(t3, CHEAP, 2, '4', true), { ...row(t3, BIG, 0, '', false), error: 'LLM HTTP 500' }];
    expect(buildTable([tm, te, t3], [...rows, ...bad], CHEAP, BIG)).toHaveLength(2);
  });
});
