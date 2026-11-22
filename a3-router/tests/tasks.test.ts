import { describe, expect, it } from 'vitest';
import { loadTasks } from '../src/tasks/index.ts';

const tasks = loadTasks();

describe('loadTasks', () => {
  it('has 480 tasks, 120 per type, unique ids', () => {
    expect(tasks).toHaveLength(480);
    expect(new Set(tasks.map((t) => t.id)).size).toBe(480);
    for (const type of ['classify', 'extract', 'math', 'qa'] as const) expect(tasks.filter((t) => t.type === type)).toHaveLength(120);
  });
  it('splits 50/50 within each type and is stable between calls', () => {
    for (const type of ['classify', 'extract', 'math', 'qa'] as const) expect(tasks.filter((t) => t.type === type && t.split === 'test')).toHaveLength(60);
    expect(loadTasks()).toEqual(tasks);
  });
  it('classify covers all six labels, including hard cases', () => {
    const labels = new Set(tasks.filter((t) => t.type === 'classify').map((t) => t.answer));
    expect([...labels].sort()).toEqual(['account', 'billing', 'bug', 'delivery', 'other', 'refund']);
    expect(tasks.some((t) => t.type === 'classify' && /не про|не по/.test(t.prompt))).toBe(true);
  });
  it('every task has a non-empty prompt and a defined answer', () => {
    for (const t of tasks) {
      expect(t.prompt.length, t.id).toBeGreaterThan(20);
      expect(t.answer, t.id).toBeDefined();
    }
  });
});
