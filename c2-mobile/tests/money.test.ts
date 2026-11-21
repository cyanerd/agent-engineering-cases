import { describe, expect, it } from 'vitest';
import { formatMoney } from '../src/money.ts';

describe('formatMoney', () => {
  it('formats kopecks with thousands separators', () => expect(formatMoney(123456)).toBe('1 234,56 ₽'));
  it('negative amounts', () => expect(formatMoney(-6400)).toBe('−64,00 ₽'));
  it('zero', () => expect(formatMoney(0)).toBe('0,00 ₽'));
  it('refuses fractional kopecks', () => expect(() => formatMoney(10.5)).toThrow());
});
