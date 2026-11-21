import { describe, expect, it } from 'vitest';
import { grade, normalizeNumber } from '../src/tasks/grade.ts';
import type { Task } from '../src/tasks/types.ts';

const t = (type: Task['type'], answer: unknown): Task => ({ id: 'x', type, prompt: 'p'.repeat(30), answer, split: 'test' });

describe('normalizeNumber', () => {
  it.each([
    ['1 200,50 ₽', 1200.5], ['$1,234', 1234], ['1,234.56', 1234.56], ['12,5', 12.5], ['€ 99', 99], ['-3', -3], ['1 000 000', 1000000],
  ])('%s -> %d', (s, n) => expect(normalizeNumber(s)).toBe(n));
  it('returns undefined without digits', () => expect(normalizeNumber('нет')).toBeUndefined());
});

describe('grade', () => {
  it('classify: label word anywhere, think block ignored', () => {
    expect(grade(t('classify', 'delivery'), '<think>maybe billing</think>\ndelivery')).toBe(true);
    expect(grade(t('classify', 'delivery'), 'Category: Delivery.')).toBe(true);
    expect(grade(t('classify', 'delivery'), 'billing')).toBe(false);
    expect(grade(t('classify', 'delivery'), 'delivery or billing')).toBe(false);
  });
  it('extract: JSON in a fence, extra fields ok, fields compared normalised', () => {
    const a = { customer: 'Анна Орлова', date: '2026-11-21', amount: 1200.5, currency: 'RUB', items: 3 };
    expect(grade(t('extract', a), '```json\n{"customer":"анна орлова","date":"2026-11-21","amount":"1 200,50","currency":"rub","items":3,"note":"x"}\n```')).toBe(true);
    expect(grade(t('extract', a), JSON.stringify({ ...a, date: '2026-11-22' }))).toBe(false);
    expect(grade(t('extract', a), 'not json')).toBe(false);
  });
  it('math and numeric qa: last number of the answer', () => {
    expect(grade(t('math', 18), 'She makes 9 * 2 = 18 dollars.\n#### 18')).toBe(true);
    expect(grade(t('math', 18), 'The answer is 18.')).toBe(true);
    expect(grade(t('math', 18), '18 ... no, 20')).toBe(false);
  });
  it('string qa: case-insensitive containment', () => {
    expect(grade(t('qa', 'Склад Б'), 'Больше отгрузил склад Б.')).toBe(true);
    expect(grade(t('qa', 'Склад Б'), 'Склад А')).toBe(false);
  });
});
