import { readFileSync } from 'node:fs';
import { CLASSIFY_INSTRUCTION, classifyTasks } from './classify.ts';
import { EXTRACT_INSTRUCTION, extractTasks } from './extract.ts';
import { QA_INSTRUCTION, qaTasks } from './qa.ts';
import { rng } from './rng.ts';
import type { Task, TaskType } from './types.ts';

export * from './types.ts';
export { grade, stripThink, normalizeNumber, parseJsonLoose } from './grade.ts';

const MATH_INSTRUCTION = 'Solve the problem. Think step by step briefly, then give the final numeric answer on the last line as "#### <number>".';

function withSplit(type: TaskType, items: { prompt: string; answer: unknown }[], instruction: string): Task[] {
  const testIdx = new Set(rng(42 + type.length).shuffle(items.map((_, i) => i)).slice(0, items.length / 2));
  return items.map((it, i) => ({ id: `${type}-${String(i + 1).padStart(3, '0')}`, type, prompt: `${instruction}\n\n${it.prompt}`, answer: it.answer, split: testIdx.has(i) ? 'test' : 'train' }));
}

export function loadTasks(): Task[] {
  const gsm = readFileSync(new URL('../../data/gsm8k-sample.jsonl', import.meta.url), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { question: string; answer: number });
  return [
    ...withSplit('classify', classifyTasks(), CLASSIFY_INSTRUCTION),
    ...withSplit('extract', extractTasks(), EXTRACT_INSTRUCTION),
    ...withSplit('math', gsm.map((g) => ({ prompt: g.question, answer: g.answer })), MATH_INSTRUCTION),
    ...withSplit('qa', qaTasks(), QA_INSTRUCTION),
  ];
}
