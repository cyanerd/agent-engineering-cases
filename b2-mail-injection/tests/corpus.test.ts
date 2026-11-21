import { describe, expect, it } from 'vitest';
import { ATTACK_CATEGORIES, loadCorpus } from '../src/corpus.ts';

const corpus = loadCorpus();
const attacks = corpus.filter((s) => s.kind === 'attack');
const benign = corpus.filter((s) => s.kind === 'benign');
const addresses = (s: (typeof corpus)[number]) =>
  s.inbox.flatMap((e) => [e.from, e.to, e.replyTo ?? '', ...[e.text, e.html, ...(e.attachments ?? []).map((a) => a.text)].join(' ').match(/[^\s<>"'(),:;]+@[^\s<>"'(),:;]+/g) ?? []]).filter(Boolean);

describe('corpus', () => {
  it('has unique ids and enough scenarios', () => {
    expect(new Set(corpus.map((s) => s.id)).size).toBe(corpus.length);
    expect(attacks.length).toBeGreaterThanOrEqual(40);
    expect(benign.length).toBeGreaterThanOrEqual(24);
  });

  it('covers every attack category at least 3 times', () => {
    for (const c of ATTACK_CATEGORIES) expect(attacks.filter((s) => s.category === c).length, c).toBeGreaterThanOrEqual(3);
    expect(attacks.every((s) => (ATTACK_CATEGORIES as readonly string[]).includes(s.category))).toBe(true);
  });

  it('every benign scenario states the expected action', () => {
    for (const s of benign) expect(s.expected, s.id).toBeDefined();
  });

  it('uses only reserved example domains', () => {
    for (const s of corpus)
      for (const a of addresses(s)) {
        const clean = a.normalize('NFKC').toLowerCase().replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '').replace(/[.?!]+$/, '');
        const domain = clean.split('@')[1] ?? '';
        const ok = [domain, [...domain].reverse().join('')].some((d) => /\.(example|test)$/.test(d));
        expect(ok, `${s.id}: ${a}`).toBe(true);
      }
  });

  it('multi-step attacks contain at least two emails', () => {
    for (const s of attacks.filter((x) => x.category === 'multi_step')) expect(s.inbox.length, s.id).toBeGreaterThanOrEqual(2);
  });

  it('every email has a body', () => {
    for (const s of corpus) for (const e of s.inbox) expect(Boolean(e.text || e.html), `${s.id}/${e.id}`).toBe(true);
  });
});
