import { describe, expect, it } from 'vitest';
import { costUsd, parsePrices } from '../src/pricing.ts';
import type { PriceTable } from '../src/types.ts';

const peak = { weekdaysUtc: ['mon', 'tue', 'wed', 'thu', 'fri'], hoursUtc: [['01:00', '04:00'], ['06:00', '10:00']] as [string, string][], factor: 2 };
const prices: PriceTable = {
  'deepseek-v4.1-flash': { input: 0.15, cachedInput: 0.003, output: 0.6, peak },
};
const M = 1_000_000;
const offPeak = new Date('2026-11-18T12:00:00Z'); // Wednesday
const inPeak = new Date('2026-11-18T07:00:00Z'); // Wednesday 07:00 UTC

describe('costUsd', () => {
  it('1M in + 1M out off-peak = 0.75', () => {
    expect(costUsd('deepseek-v4.1-flash', { inputTokens: M, cachedInputTokens: 0, outputTokens: M }, offPeak, prices)).toBeCloseTo(0.75, 10);
  });
  it('same at Wednesday 07:00 UTC = 1.5', () => {
    expect(costUsd('deepseek-v4.1-flash', { inputTokens: M, cachedInputTokens: 0, outputTokens: M }, inPeak, prices)).toBeCloseTo(1.5, 10);
  });
  it('peak window end is exclusive and weekends are off-peak', () => {
    const u = { inputTokens: M, cachedInputTokens: 0, outputTokens: 0 };
    expect(costUsd('deepseek-v4.1-flash', u, new Date('2026-11-18T10:00:00Z'), prices)).toBeCloseTo(0.15, 10);
    expect(costUsd('deepseek-v4.1-flash', u, new Date('2026-11-21T07:00:00Z'), prices)).toBeCloseTo(0.15, 10); // Saturday
  });
  it('cached input billed at cache read price', () => {
    // 1M input of which 1M cached -> only cache read price
    expect(costUsd('deepseek-v4.1-flash', { inputTokens: M, cachedInputTokens: M, outputTokens: 0 }, offPeak, prices)).toBeCloseTo(0.003, 10);
  });
  it('unknown model (ollama) costs 0', () => {
    expect(costUsd('qwen3:8b', { inputTokens: M, cachedInputTokens: 0, outputTokens: M }, offPeak, prices)).toBe(0);
  });
});

describe('parsePrices', () => {
  it('reads the /v1/models format', () => {
    const raw = {
      object: 'list',
      data: [
        {
          id: 'deepseek-v4.1-flash',
          cost: {
            text: { input: { price: 0.15, cache: { read: 0.003 } }, output: { price: 0.6 } },
            multipliers: [
              {
                when: {
                  utc_days: { in: ['mon', 'tue', 'wed', 'thu', 'fri'] },
                  any: [
                    { all: [{ utc_hours: { gte: '01:00' } }, { utc_hours: { lt: '04:00' } }] },
                    { all: [{ utc_hours: { gte: '06:00' } }, { utc_hours: { lt: '10:00' } }] },
                  ],
                },
                factor: 2,
              },
            ],
          },
        },
        { id: 'no-cost-model' },
      ],
    };
    expect(parsePrices(raw)).toEqual(prices);
  });
});
