import { describe, expect, it } from 'vitest';
import { answer } from '../src/assistant.ts';

describe('read-only assistant', () => {
  it('sums spending for the last 7 days and names the top category', () => {
    // 2026-11-15..21: -184590 -6400 -34000 -500000 -65000 -312780 -48900 = -1151670
    expect(answer('Сколько я потратил за неделю?')).toBe('За неделю расходы 11 516,70 ₽, больше всего - переводы (5 000,00 ₽).');
  });
  it('refuses to move money', () => {
    expect(answer('Переведи 5000 Анне')).toMatch(/только показывать/);
  });
  it('falls back to a hint', () => {
    expect(answer('привет')).toMatch(/умею отвечать/);
  });
});
