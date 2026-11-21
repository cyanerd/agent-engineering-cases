import { describe, expect, it } from 'vitest';
import { prGuard, type PrInput } from '../scripts/pr-guard.ts';

const base: PrInput = { files: [], labels: [], body: 'Scope: c1-agent-pr/src/notify/**', autoMerge: false };
const f = (path: string, additions = 10, deletions = 0, previousPath?: string) => ({ path, additions, deletions, ...(previousPath ? { previousPath } : {}) });
const checks = (i: PrInput) => prGuard(i).failures.map((x) => x.check).sort();

describe('prGuard', () => {
  it('passes a small PR inside its declared scope that does not touch critical paths', () => {
    expect(prGuard({ ...base, files: [f('c1-agent-pr/src/notify/email.ts')] })).toEqual({ ok: true, failures: [] });
  });

  it('a PR without a Scope line fails instead of passing', () => {
    expect(checks({ ...base, body: 'some description', files: [f('c1-agent-pr/src/notify/email.ts')] })).toEqual(['scope']);
  });

  it('files outside the declared scope fail the scope check', () => {
    expect(checks({ ...base, files: [f('c1-agent-pr/src/notify/email.ts'), f('b2-mail-injection/src/agent.ts')] })).toEqual(['scope']);
  });

  it('touching the provider layer with automerge fails critical-path-no-automerge and needs review', () => {
    const i = { ...base, body: 'Scope: c1-agent-pr/src/**', labels: ['automerge'], files: [f('c1-agent-pr/src/providers/http.ts')] };
    expect(checks(i)).toEqual(['critical-path-no-automerge', 'critical-review-label']);
  });

  it('auto-merge enabled through the GitHub setting counts like the label', () => {
    expect(checks({ ...base, body: 'Scope: c1-agent-pr/src/**', autoMerge: true, files: [f('c1-agent-pr/src/sender.ts')] })).toContain('critical-path-no-automerge');
  });

  it('a file moved out of the provider layer is still a critical change', () => {
    expect(checks({ ...base, body: 'Scope: c1-agent-pr/**', files: [f('c1-agent-pr/lib/gateway.ts', 0, 0, 'c1-agent-pr/src/providers/http.ts')] })).toEqual(['critical-review-label']);
  });

  it('the critical-reviewed label clears the review check but not automerge', () => {
    const i = { ...base, body: 'Scope: c1-agent-pr/src/**', labels: ['automerge', 'critical-reviewed'], files: [f('c1-agent-pr/src/sender.ts')] };
    expect(checks(i)).toEqual(['critical-path-no-automerge']);
  });

  it('size limit counts changed code lines in critical paths, not lock files or snapshots', () => {
    const big = { ...base, body: 'Scope: c1-agent-pr/** pnpm-lock.yaml', labels: ['critical-reviewed'], files: [f('c1-agent-pr/src/sender.ts', 300, 150), f('pnpm-lock.yaml', 5000, 3000)] };
    expect(checks(big)).toEqual(['size-limit']);
    expect(checks({ ...big, files: [f('c1-agent-pr/src/sender.ts', 200, 150), f('pnpm-lock.yaml', 5000, 3000)] })).toEqual([]);
  });
});
