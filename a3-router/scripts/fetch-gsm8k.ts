/** Downloads GSM8K test (MIT, github.com/openai/grade-school-math) and keeps a seeded sample of 120. */
import { writeFileSync } from 'node:fs';
import { rng } from '../src/tasks/rng.ts';

const URL_ = 'https://raw.githubusercontent.com/openai/grade-school-math/master/grade_school_math/data/test.jsonl';
const res = await fetch(URL_);
if (!res.ok) throw new Error(`GSM8K ${res.status}`);
const rows = (await res.text()).trim().split('\n').map((l, i) => ({ i, ...(JSON.parse(l) as { question: string; answer: string }) }));
const sample = rng(42).shuffle(rows).slice(0, 120).sort((a, b) => a.i - b.i);
const out = sample.map((r) => JSON.stringify({ source: `gsm8k/test.jsonl#${r.i}`, question: r.question, answer: Number(r.answer.split('####')[1]!.trim().replace(/,/g, '')) }));
writeFileSync(new URL('../data/gsm8k-sample.jsonl', import.meta.url), `${out.join('\n')}\n`);
console.log(`saved ${out.length} of ${rows.length}`);
