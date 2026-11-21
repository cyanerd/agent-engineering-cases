/**
 * Process checks for pull requests that the test suite cannot express.
 *   critical-path-no-automerge  the SMS module, its contract tests, the guard and CI are never auto-merged
 *   critical-review             changes there need an approval from a code owner at the current head commit
 *   size-limit                  more than 400 changed lines in critical paths must be split
 *   scope                       the PR declares `Scope: <globs>` (not "everything") and touches nothing outside it
 * Runs from the base branch (pull_request_target) and only reads PR data, so a PR cannot edit the guard that judges it.
 * CLI: tsx pr-guard.ts <github event json> <pulls/N/files json> <pulls/N/reviews json> <CODEOWNERS path>
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface PrFile {
  path: string;
  additions: number;
  deletions: number;
  previousPath?: string;
}
export interface Review {
  user: string;
  state: string;
  commitId: string;
}
export interface PrInput {
  files: PrFile[];
  labels: string[];
  body: string;
  autoMerge: boolean;
  reviews: Review[];
  headSha: string;
  codeOwners: string[];
}
export interface Failure {
  check: string;
  reason: string;
}

/** The whole module (docs aside) plus CI: listing single files is bypassed by moving code into a new directory. */
export const CRITICAL = ['c1-agent-pr/**', '.github/**'];
export const NOT_CRITICAL = ['c1-agent-pr/**/*.md', 'c1-agent-pr/docs/**'];
export const RELEVANT = ['c1-agent-pr/**', '.github/**'];
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
const isCritical = (p: string) => matchesAny(p, CRITICAL) && !matchesAny(p, NOT_CRITICAL);

/** Scope line outside HTML comments and code fences. */
function scopeGlobs(body: string): string[] | undefined {
  const visible = body.replace(/<!--[\s\S]*?(-->|$)/g, '').replace(/```[\s\S]*?(```|$)/g, '');
  const line = visible.split('\n').find((l) => /^\s*Scope:/i.test(l));
  return line?.replace(/^\s*Scope:/i, '').trim().split(/[\s,]+/).filter(Boolean);
}
/** A glob is too broad when it does not start with a concrete top-level directory or file. */
const tooBroad = (g: string) => /^[*?]/.test(g) || g === '/' || g === '';

export function prGuard(pr: PrInput): { ok: boolean; failures: Failure[] } {
  if (!pr.files.some((f) => paths(f).some((p) => matchesAny(p, RELEVANT)))) return { ok: true, failures: [] };
  const failures: Failure[] = [];
  const critical = pr.files.filter((f) => paths(f).some(isCritical));

  if (critical.length > 0) {
    if (pr.autoMerge || pr.labels.includes('automerge'))
      failures.push({ check: 'critical-path-no-automerge', reason: `auto-merge is not allowed for critical paths: ${critical.map((f) => f.path).join(', ')}` });
    const owners = new Set(pr.codeOwners.map((o) => o.replace(/^@/, '').toLowerCase()));
    const approved = pr.reviews.some((r) => r.state === 'APPROVED' && r.commitId === pr.headSha && owners.has(r.user.toLowerCase()));
    if (!approved) failures.push({ check: 'critical-review', reason: 'critical paths need an approval from a code owner at the current head commit' });
    const changed = critical.reduce((s, f) => s + f.additions + f.deletions, 0);
    if (changed > SIZE_LIMIT) failures.push({ check: 'size-limit', reason: `${changed} changed lines in critical paths (limit ${SIZE_LIMIT}): split the refactor from the feature` });
  }

  const globs = scopeGlobs(pr.body);
  if (!globs || globs.length === 0) failures.push({ check: 'scope', reason: 'the PR description must declare `Scope: <globs>` - what the task is allowed to touch' });
  else if (globs.some(tooBroad)) failures.push({ check: 'scope', reason: `scope is too broad: ${globs.filter(tooBroad).join(' ')}` });
  else {
    const outside = pr.files.filter((f) => !paths(f).every((p) => matchesAny(p, globs)));
    if (outside.length) failures.push({ check: 'scope', reason: `files outside the declared scope: ${outside.map((f) => f.path).join(', ')}` });
  }
  return { ok: failures.length === 0, failures };
}

const clean = (s: string) => s.replace(/[\r\n%]/g, ' ');

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [eventPath, filesPath, reviewsPath, ownersPath] = process.argv.slice(2) as [string, string, string, string];
  const event = JSON.parse(readFileSync(eventPath, 'utf8'));
  const files = (JSON.parse(readFileSync(filesPath, 'utf8')) as { filename: string; additions: number; deletions: number; previous_filename?: string }[]).map((f) => ({
    path: f.filename, additions: f.additions, deletions: f.deletions, ...(f.previous_filename ? { previousPath: f.previous_filename } : {}),
  }));
  const reviews = (JSON.parse(readFileSync(reviewsPath, 'utf8')) as { user: { login: string }; state: string; commit_id: string }[]).map((r) => ({ user: r.user.login, state: r.state, commitId: r.commit_id }));
  const codeOwners = [...new Set(readFileSync(ownersPath, 'utf8').match(/@[\w-]+/g) ?? [])];
  const pr = event.pull_request;
  const r = prGuard({ files, labels: (pr.labels ?? []).map((l: { name: string }) => l.name), body: pr.body ?? '', autoMerge: !!pr.auto_merge, reviews, headSha: pr.head.sha, codeOwners });
  for (const f of r.failures) console.log(`::error title=pr-guard: ${f.check}::${clean(f.reason)}`);
  console.log(r.ok ? 'pr-guard: all checks passed' : `pr-guard: ${r.failures.length} check(s) failed`);
  process.exit(r.ok ? 0 : 1);
}
