/**
 * Process checks for pull requests that the test suite cannot express.
 *   critical-path-no-automerge  the SMS/provider layer is never auto-merged
 *   critical-review-label       changes to it need an explicit human review mark (`critical-reviewed`)
 *   size-limit                  more than 400 changed lines in critical paths must be split
 *   scope                       the PR declares `Scope: <globs>` and touches nothing outside it
 * CLI: tsx pr-guard.ts <github event json> <pulls/N/files json>
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface PrFile {
  path: string;
  additions: number;
  deletions: number;
  previousPath?: string;
}
export interface PrInput {
  files: PrFile[];
  labels: string[];
  body: string;
  autoMerge: boolean;
}
export interface Failure {
  check: string;
  reason: string;
}

export const CRITICAL = ['c1-agent-pr/src/providers/**', 'c1-agent-pr/src/sender.ts', 'c1-agent-pr/src/types.ts'];
export const SIZE_LIMIT = 400;

export function globToRegExp(glob: string): RegExp {
  const re = glob
    .split('**')
    .map((part) => part.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]'))
    .join('.*');
  return new RegExp(`^${re}$`);
}
const matchesAny = (path: string, globs: string[]) => globs.some((g) => globToRegExp(g).test(path));
const paths = (f: PrFile) => [f.path, ...(f.previousPath ? [f.previousPath] : [])];

export function prGuard(pr: PrInput): { ok: boolean; failures: Failure[] } {
  const failures: Failure[] = [];
  const critical = pr.files.filter((f) => paths(f).some((p) => matchesAny(p, CRITICAL)));

  if (critical.length > 0) {
    if (pr.autoMerge || pr.labels.includes('automerge'))
      failures.push({ check: 'critical-path-no-automerge', reason: `auto-merge is not allowed for the SMS provider layer: ${critical.map((f) => f.path).join(', ')}` });
    if (!pr.labels.includes('critical-reviewed'))
      failures.push({ check: 'critical-review-label', reason: 'changes to the SMS provider layer need a human review mark (label `critical-reviewed`) from a code owner' });
    const changed = critical.reduce((s, f) => s + f.additions + f.deletions, 0);
    if (changed > SIZE_LIMIT) failures.push({ check: 'size-limit', reason: `${changed} changed lines in critical paths (limit ${SIZE_LIMIT}): split the refactor from the feature` });
  }

  const scopeLine = pr.body.split('\n').find((l) => /^\s*Scope:/i.test(l));
  if (!scopeLine) failures.push({ check: 'scope', reason: 'the PR description must declare `Scope: <globs>` - what the task is allowed to touch' });
  else {
    const globs = scopeLine.replace(/^\s*Scope:/i, '').trim().split(/[\s,]+/).filter(Boolean);
    const outside = pr.files.filter((f) => !paths(f).every((p) => matchesAny(p, globs)));
    if (outside.length) failures.push({ check: 'scope', reason: `files outside the declared scope: ${outside.map((f) => f.path).join(', ')}` });
  }
  return { ok: failures.length === 0, failures };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const event = JSON.parse(readFileSync(process.argv[2]!, 'utf8'));
  const files = (JSON.parse(readFileSync(process.argv[3]!, 'utf8')) as { filename: string; additions: number; deletions: number; previous_filename?: string }[]).map((f) => ({
    path: f.filename, additions: f.additions, deletions: f.deletions, ...(f.previous_filename ? { previousPath: f.previous_filename } : {}),
  }));
  const pr = event.pull_request;
  const r = prGuard({ files, labels: (pr.labels ?? []).map((l: { name: string }) => l.name), body: pr.body ?? '', autoMerge: !!pr.auto_merge });
  for (const f of r.failures) console.log(`::error title=pr-guard: ${f.check}::${f.reason}`);
  console.log(r.ok ? 'pr-guard: all checks passed' : `pr-guard: ${r.failures.length} check(s) failed`);
  process.exit(r.ok ? 0 : 1);
}
