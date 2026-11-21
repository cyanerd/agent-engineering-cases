import { describe, expect, it } from 'vitest';
import { prGuard, type PrInput } from '../scripts/pr-guard.ts';

const HEAD = 'head-sha';
const ownerOk = [{ user: 'cyanerd', state: 'APPROVED', commitId: HEAD }];
const base: PrInput = { files: [], labels: [], body: 'Scope: c1-agent-pr/docs/**', autoMerge: false, reviews: [], headSha: HEAD, codeOwners: ['cyanerd'] };
const f = (path: string, additions = 10, deletions = 0, previousPath?: string) => ({ path, additions, deletions, ...(previousPath ? { previousPath } : {}) });
const checks = (i: PrInput) => prGuard(i).failures.map((x) => x.check).sort();

describe('prGuard', () => {
  it('passes a small PR inside its declared scope that does not touch critical paths', () => {
    expect(prGuard({ ...base, files: [f('c1-agent-pr/docs/notes.md')] })).toEqual({ ok: true, failures: [] });
  });

  it('PRs that do not touch the SMS module or CI are not its business', () => {
    expect(prGuard({ ...base, body: '', files: [f('b2-mail-injection/src/agent.ts', 900)] })).toEqual({ ok: true, failures: [] });
  });

  it('a PR without a Scope line fails instead of passing', () => {
    expect(checks({ ...base, body: 'some description', files: [f('c1-agent-pr/docs/notes.md')] })).toEqual(['scope']);
  });

  it('files outside the declared scope fail the scope check', () => {
    expect(checks({ ...base, files: [f('c1-agent-pr/docs/notes.md'), f('b2-mail-injection/src/agent.ts')] })).toEqual(['scope']);
  });

  it('a scope that matches everything is refused', () => {
    expect(checks({ ...base, body: 'Scope: **', files: [f('c1-agent-pr/docs/notes.md')] })).toEqual(['scope']);
    expect(checks({ ...base, body: 'Scope: *', files: [f('c1-agent-pr/docs/notes.md')] })).toEqual(['scope']);
  });

  it('a Scope line hidden in an HTML comment or a code fence does not count', () => {
    expect(checks({ ...base, body: '<!--\nScope: c1-agent-pr/docs/**\n-->', files: [f('c1-agent-pr/docs/notes.md')] })).toEqual(['scope']);
    expect(checks({ ...base, body: '```\nScope: c1-agent-pr/docs/**\n```', files: [f('c1-agent-pr/docs/notes.md')] })).toEqual(['scope']);
  });

  it('touching the provider layer with automerge fails critical-path-no-automerge and needs an owner approval', () => {
    const i = { ...base, body: 'Scope: c1-agent-pr/src/**', labels: ['automerge'], files: [f('c1-agent-pr/src/providers/http.ts')] };
    expect(checks(i)).toEqual(['critical-path-no-automerge', 'critical-review']);
  });

  it('auto-merge enabled through the GitHub setting counts like the label', () => {
    expect(checks({ ...base, body: 'Scope: c1-agent-pr/src/**', autoMerge: true, reviews: ownerOk, files: [f('c1-agent-pr/src/sender.ts')] })).toEqual(['critical-path-no-automerge']);
  });

  it('a file moved out of the provider layer is still a critical change', () => {
    expect(checks({ ...base, body: 'Scope: c1-agent-pr/**', files: [f('c1-agent-pr/lib/gateway.ts', 0, 0, 'c1-agent-pr/src/providers/http.ts')] })).toEqual(['critical-review']);
  });

  it('an owner approval counts only at the current head commit; labels and non-owners do not count', () => {
    const i = { ...base, body: 'Scope: c1-agent-pr/src/**', files: [f('c1-agent-pr/src/sender.ts')] };
    expect(checks({ ...i, reviews: ownerOk })).toEqual([]);
    expect(checks({ ...i, reviews: [{ user: 'cyanerd', state: 'APPROVED', commitId: 'older-sha' }] })).toEqual(['critical-review']);
    expect(checks({ ...i, reviews: [{ user: 'someone', state: 'APPROVED', commitId: HEAD }] })).toEqual(['critical-review']);
    expect(checks({ ...i, labels: ['critical-reviewed'] })).toEqual(['critical-review']);
  });

  it('the guard itself, the contract tests, CI and package scripts are critical', () => {
    for (const p of ['c1-agent-pr/scripts/pr-guard.ts', 'c1-agent-pr/contract/fake-provider.ts', 'c1-agent-pr/package.json', '.github/workflows/pr-guard.yml', '.github/CODEOWNERS'])
      expect(checks({ ...base, body: 'Scope: c1-agent-pr/** .github/**', files: [f(p)] }), p).toEqual(['critical-review']);
  });

  it('size limit counts changed code lines in critical paths, not lock files', () => {
    const big = { ...base, body: 'Scope: c1-agent-pr/** pnpm-lock.yaml', reviews: ownerOk, files: [f('c1-agent-pr/src/sender.ts', 300, 150), f('pnpm-lock.yaml', 5000, 3000)] };
    expect(checks(big)).toEqual(['size-limit']);
    expect(checks({ ...big, files: [f('c1-agent-pr/src/sender.ts', 200, 150), f('pnpm-lock.yaml', 5000, 3000)] })).toEqual([]);
  });

  it('code moved into a new directory of the SMS module is still critical (found on PR #3: src/gateway/**)', () => {
    const i = { ...base, body: 'Scope: c1-agent-pr/**', reviews: ownerOk, files: [f('c1-agent-pr/src/gateway/dispatcher.ts', 150), f('c1-agent-pr/lib/registry.ts', 80), f('c1-agent-pr/src/sender.ts', 25, 50), f('c1-agent-pr/src/gateway/retry.ts', 200)] };
    expect(checks(i)).toEqual(['size-limit']);
  });
});
