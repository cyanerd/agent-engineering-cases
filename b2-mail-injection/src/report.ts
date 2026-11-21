/** Builds results/summary.csv and results/summary.md from results/<model>/<profile>.jsonl. */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RunRecord } from './agent.ts';
import { summarize, wilson } from './metrics.ts';
import { PROFILES } from './profiles.ts';

const dir = new URL('../results/', import.meta.url).pathname;
const records: RunRecord[] = [];
for (const m of readdirSync(dir).filter((d) => statSync(join(dir, d)).isDirectory()))
  for (const f of readdirSync(join(dir, m)).filter((x) => x.endsWith('.jsonl')))
    for (const line of readFileSync(join(dir, m, f), 'utf8').split('\n').filter(Boolean)) records.push(JSON.parse(line));

const order = (p: string) => PROFILES.findIndex((x) => x.id === p);
const rows = summarize(records).sort((a, b) => a.model.localeCompare(b.model) || order(a.profile) - order(b.profile));
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

const header = ['model', 'profile', 'n_attacks', 'asr', 'asr_lo', 'asr_hi', 'attempted_blocked', 'friction_blocked', 'n_benign', 'benign_done', 'false_block', 'pending_approval', 'not_done', 'errors', 'cost_usd', 'avg_steps'];
const csv = [header.join(','), ...rows.map((r) => [r.model, r.profile, r.nAttacks, r.asr, r.asrLo, r.asrHi, r.attemptedBlocked, r.frictionBlocked, r.nBenign, r.benignDone, r.falseBlock, r.pendingApproval, r.notDone, r.errors, r.costUsd, r.avgSteps].map((v) => (typeof v === 'number' ? Number(v.toFixed(6)) : v)).join(','))];
writeFileSync(join(dir, 'summary.csv'), `${csv.join('\n')}\n`);

const md: string[] = [
  '## Матрица «профиль защиты × модель»',
  '',
  '| Модель | Профиль | Атак (прогонов) | Утечки (ASR) | 95% ДИ | Утечка остановлена слоем | Заблокировано безвредное | Обычных | Выполнено | Ложная блокировка | Ждёт человека | Не сделано | Ошибки | $ |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ...rows.map((r) => `| ${r.model} | ${r.profile} | ${r.nAttacks} | ${pct(r.asr)} | ${pct(r.asrLo)}-${pct(r.asrHi)} | ${r.attemptedBlocked} | ${r.frictionBlocked} | ${r.nBenign} | ${pct(r.benignDone)} | ${pct(r.falseBlock)} | ${pct(r.pendingApproval)} | ${pct(r.notDone)} | ${r.errors} | ${r.costUsd.toFixed(3)} |`),
  '',
  '## Утечки по категориям атак',
  '',
];
const models = [...new Set(records.map((r) => r.model))].sort();
const profiles = PROFILES.map((p) => p.id).filter((p) => records.some((r) => r.profile === p));
const cats = [...new Set(records.filter((r) => r.kind === 'attack').map((r) => r.category))].sort();
for (const m of models) {
  md.push(`### ${m}`, '', `| Категория | ${profiles.join(' | ')} |`, `|---|${profiles.map(() => '---').join('|')}|`);
  for (const c of cats) {
    const cells = profiles.map((p) => {
      const rs = records.filter((r) => r.model === m && r.profile === p && r.category === c && !r.error);
      return rs.length ? `${rs.filter((r) => r.verdict.leaked).length}/${rs.length}` : '-';
    });
    md.push(`| ${c} | ${cells.join(' | ')} |`);
  }
  md.push('');
}
const allAttacks = records.filter((r) => r.kind === 'attack' && !r.error);
md.push(`Всего прогонов: ${records.length}, атак без ошибок: ${allAttacks.length}, из них утечек: ${allAttacks.filter((r) => r.verdict.leaked).length} (${pct(wilson(allAttacks.filter((r) => r.verdict.leaked).length, allAttacks.length).p)}).`, '');
writeFileSync(join(dir, 'summary.md'), md.join('\n'));
console.log(md.slice(0, rows.length + 4).join('\n'));
