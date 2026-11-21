import type { ChatRequest, ChatResult } from '@aec/llm';
import { describe, expect, it } from 'vitest';
import { answerTasks, type ModelSpec } from '../src/run.ts';
import type { Task } from '../src/tasks/types.ts';

const tasks: Task[] = [
  { id: 'math-001', type: 'math', prompt: 'm'.repeat(30), answer: 4, split: 'test' },
  { id: 'extract-001', type: 'extract', prompt: 'e'.repeat(30), answer: { customer: 'A', date: '2026-01-01', amount: 1, currency: 'RUB', items: 1 }, split: 'train' },
];
const cheap: ModelSpec = { key: 'cheap', provider: 'ollama', model: 'stub-small', samples: 3, concurrency: 2 };
const pricey: ModelSpec = { key: 'expensive', provider: 'opencode', model: 'stub-big', samples: 1, concurrency: 2 };

function llm(fail?: (r: ChatRequest) => boolean) {
  const reqs: ChatRequest[] = [];
  return {
    reqs,
    chat: async (r: ChatRequest): Promise<ChatResult> => {
      reqs.push(r);
      if (fail?.(r)) throw new Error('LLM HTTP 500');
      return { message: { role: 'assistant', content: '#### 4' }, usage: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 3 }, costUsd: 0.001, latencyMs: 5, cached: false, model: r.model };
    },
  };
}

describe('answerTasks', () => {
  it('writes one row per task x model x sample with grading', async () => {
    const l = llm();
    const rows = await answerTasks(tasks, [cheap, pricey], l);
    expect(rows).toHaveLength(2 * 3 + 2 * 1);
    expect(rows.find((r) => r.taskId === 'math-001' && r.model === 'stub-big')).toMatchObject({ sample: 0, correct: true, costUsd: 0.001 });
    expect(rows.find((r) => r.taskId === 'extract-001')?.correct).toBe(false);
  });
  it('sample 0 is greedy, later samples use temperature 0.7; extract asks for json_object', async () => {
    const l = llm();
    await answerTasks(tasks, [cheap], l);
    const math = l.reqs.filter((r) => r.messages[0]!.content === tasks[0]!.prompt);
    expect(math.map((r) => [r.temperature, r.sample])).toEqual([[0, 0], [0.7, 1], [0.7, 2]]);
    expect(l.reqs.find((r) => r.messages[0]!.content === tasks[1]!.prompt)?.responseFormat).toEqual({ type: 'json_object' });
  });
  it('a model error is recorded without a correct field', async () => {
    const rows = await answerTasks(tasks, [pricey], llm(() => true));
    expect(rows.every((r) => r.error && !('correct' in r))).toBe(true);
  });
  it('rows are ordered deterministically regardless of completion order', async () => {
    const a = await answerTasks(tasks, [cheap, pricey], llm());
    const b = await answerTasks([...tasks].reverse(), [pricey, cheap], llm());
    expect(b.map((r) => `${r.taskId}/${r.model}/${r.sample}`)).toEqual(a.map((r) => `${r.taskId}/${r.model}/${r.sample}`));
  });

  it('a fast variant of the cheap model asks it not to think and is recorded under its own label', async () => {
    const l = llm();
    const fast: ModelSpec = { key: 'fast', provider: 'ollama', model: 'stub-small', label: 'stub-small-nothink', noThink: true, samples: 1, concurrency: 1 };
    const rows = await answerTasks([tasks[0]!], [fast], l);
    expect(rows[0]!.model).toBe('stub-small-nothink');
    expect(l.reqs[0]!.messages[0]).toEqual({ role: 'system', content: '/no_think' });
  });
});
