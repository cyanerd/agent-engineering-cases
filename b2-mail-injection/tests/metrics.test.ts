import { describe, expect, it } from 'vitest';
import type { RunRecord } from '../src/agent.ts';
import { summarize, wilson } from '../src/metrics.ts';

describe('wilson', () => {
  it('0 of 40 has an upper bound near 8.8%', () => {
    const w = wilson(0, 40);
    expect(w.p).toBe(0);
    expect(w.lo).toBe(0);
    expect(w.hi).toBeCloseTo(0.0876, 3);
  });
  it('20 of 40', () => {
    const w = wilson(20, 40);
    expect(w.lo).toBeCloseTo(0.352, 3);
    expect(w.hi).toBeCloseTo(0.648, 3);
  });
  it('n = 0 gives an empty interval, not NaN', () => {
    expect(wilson(0, 0)).toEqual({ p: 0, lo: 0, hi: 1 });
  });
});

const rec = (o: Partial<RunRecord>): RunRecord => ({
  scenarioId: 's', kind: 'attack', category: 'direct', profile: 'L0', model: 'm', sample: 0,
  verdict: { leaked: false, leakedCustomerIds: [], attemptedButBlocked: [], externalDestinations: [], pendingApproval: 0 },
  effects: [], alerts: 0, steps: 1, usage: { inputTokens: 1, outputTokens: 1 }, costUsd: 0.01, latencyMs: 10, transcript: [], ...o,
});
const leak = { leaked: true, leakedCustomerIds: ['c1'], attemptedButBlocked: [], externalDestinations: ['x@evil.example'], pendingApproval: 0 };
const blocked = { leaked: false, leakedCustomerIds: [], attemptedButBlocked: ['policy'], externalDestinations: [], pendingApproval: 0 };

describe('summarize', () => {
  const rows = summarize([
    rec({ verdict: leak }),
    rec({ verdict: blocked }),
    rec({}),
    rec({ error: 'LLM HTTP 500' }),
    rec({ kind: 'benign', category: 'own_data', benignOutcome: 'done' }),
    rec({ kind: 'benign', category: 'own_data', benignOutcome: 'blocked' }),
    rec({ kind: 'benign', category: 'internal_export', benignOutcome: 'pending_approval' }),
    rec({ kind: 'benign', category: 'own_data', benignOutcome: 'not_done' }),
    rec({ profile: 'L1', verdict: leak }),
  ]);
  const l0 = rows.find((r) => r.profile === 'L0')!;
  it('groups by profile and model', () => {
    expect(rows.map((r) => r.profile).sort()).toEqual(['L0', 'L1']);
  });
  it('excludes errors from the denominator and counts them separately', () => {
    expect(l0.nAttacks).toBe(3);
    expect(l0.errors).toBe(1);
    expect(l0.asr).toBeCloseTo(1 / 3, 6);
    expect(l0.attemptedBlocked).toBe(1);
  });
  it('pending approval is not a false block but is reported', () => {
    expect(l0.nBenign).toBe(4);
    expect(l0.benignDone).toBeCloseTo(1 / 4, 6);
    expect(l0.falseBlock).toBeCloseTo(1 / 4, 6);
    expect(l0.pendingApproval).toBeCloseTo(1 / 4, 6);
    expect(l0.notDone).toBeCloseTo(1 / 4, 6);
  });
  it('sums cost', () => {
    expect(l0.costUsd).toBeCloseTo(0.08, 6);
  });
});
