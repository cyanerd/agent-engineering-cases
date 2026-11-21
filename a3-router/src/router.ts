import type { AnswerRow } from './run.ts';
import { lastNumber, parseJsonLoose } from './tasks/grade.ts';
import { LABELS, type Task, type TaskType } from './tasks/types.ts';

export interface Entry {
  task: Task;
  /** Cheap model samples ordered by sample index; [0] is the greedy answer the user would get. */
  cheap: AnswerRow[];
  expensive: AnswerRow;
}
export type Route = 'cheap' | 'expensive';
export type Policy = (e: Entry) => Route;

/** Joins answers per task. Tasks where any needed answer errored are dropped, the same for every policy. */
export function buildTable(tasks: Task[], rows: AnswerRow[], cheapModel: string, expensiveModel: string): Entry[] {
  const by = new Map<string, AnswerRow[]>();
  for (const r of rows) by.set(r.taskId, [...(by.get(r.taskId) ?? []), r]);
  return tasks.flatMap((task) => {
    const rs = by.get(task.id) ?? [];
    const cheap = rs.filter((r) => r.model === cheapModel).sort((a, b) => a.sample - b.sample);
    const expensive = rs.find((r) => r.model === expensiveModel && r.sample === 0);
    if (!expensive || cheap.length === 0 || expensive.error || cheap.some((r) => r.error)) return [];
    return [{ task, cheap, expensive }];
  });
}

/** Meaning-level form of an answer, so that agreement between samples ignores formatting. */
export function canonical(task: Task, output: string): string {
  switch (task.type) {
    case 'classify':
      return LABELS.filter((l) => new RegExp(`\\b${l}\\b`, 'i').test(output)).join('|');
    case 'extract': {
      const o = parseJsonLoose(output);
      if (!o) return '';
      const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' ? lastNumber(v) : undefined);
      return JSON.stringify([String(o.customer ?? '').trim().toLowerCase(), String(o.date ?? '').trim(), num(o.amount), String(o.currency ?? '').toUpperCase(), num(o.items)]);
    }
    default: {
      if (typeof task.answer === 'number' || task.type === 'math') return String(lastNumber(output) ?? '');
      return output.trim().toLowerCase().replace(/[.!]+$/, '');
    }
  }
}

export function validJson(e: Entry): boolean {
  if (e.task.type !== 'extract') return true;
  const o = parseJsonLoose(e.cheap[0]!.output ?? '');
  return !!o && typeof o.customer === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(String(o.date)) && o.amount !== undefined && typeof o.currency === 'string' && o.items !== undefined;
}

export function agreement(e: Entry): number {
  const first = canonical(e.task, e.cheap[0]!.output ?? '');
  if (first === '') return 0;
  return e.cheap.filter((r) => canonical(e.task, r.output ?? '') === first).length;
}

export const allCheap: Policy = () => 'cheap';
export const allExpensive: Policy = () => 'expensive';
export const byType = (rule: Record<TaskType, Route>): Policy => (e) => rule[e.task.type];

export interface CascadeConfig {
  requireValidJson: boolean;
  minAgreement: 1 | 2 | 3;
  typesToExpensive?: TaskType[];
}
export const cascade = (c: CascadeConfig): Policy => (e) => {
  if (c.typesToExpensive?.includes(e.task.type)) return 'expensive';
  if (c.requireValidJson && !validJson(e)) return 'expensive';
  return agreement(e) >= c.minAgreement ? 'cheap' : 'expensive';
};

const acc = (xs: boolean[]) => xs.filter(Boolean).length / Math.max(1, xs.length);

/** For each type: cheap unless its train accuracy is worse than the expensive one by more than delta. */
export function learnTypeRule(train: Entry[], delta: number): Record<TaskType, Route> {
  const rule = {} as Record<TaskType, Route>;
  for (const t of ['classify', 'extract', 'math', 'qa'] as const) {
    const es = train.filter((e) => e.task.type === t);
    rule[t] = es.length && acc(es.map((e) => !!e.cheap[0]!.correct)) >= acc(es.map((e) => !!e.expensive.correct)) - delta ? 'cheap' : 'expensive';
  }
  return rule;
}

export interface Outcome {
  correct: boolean[];
  accuracy: number;
  expensiveShare: number;
  costPer1000Usd: number;
  p50LatencyMs: number;
}

/** Cheap answers are local (cost 0); a cascade waits for all cheap samples it compares, then maybe for the expensive call. */
export function evaluate(policy: Policy, table: Entry[], samplesUsed = 1): Outcome {
  const routes = table.map(policy);
  const correct = table.map((e, i) => (routes[i] === 'cheap' ? !!e.cheap[0]!.correct : !!e.expensive.correct));
  const cost = table.reduce((s, e, i) => s + (routes[i] === 'expensive' ? e.expensive.costUsd : 0), 0);
  const lat = table
    .map((e, i) => Math.max(...e.cheap.slice(0, samplesUsed).map((r) => r.latencyMs)) * (samplesUsed > 0 ? 1 : 0) + (routes[i] === 'expensive' ? e.expensive.latencyMs : 0))
    .sort((a, b) => a - b);
  return {
    correct,
    accuracy: acc(correct),
    expensiveShare: routes.filter((r) => r === 'expensive').length / Math.max(1, table.length),
    costPer1000Usd: (cost / Math.max(1, table.length)) * 1000,
    p50LatencyMs: lat[Math.floor(lat.length / 2)] ?? 0,
  };
}
