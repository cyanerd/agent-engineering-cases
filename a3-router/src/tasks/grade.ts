import type { Order } from './extract.ts';
import { LABELS, type Task } from './types.ts';

export function stripThink(s: string): string {
  return s.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

/** Parses '1 200,50 ₽', '$1,234', '1,234.56', '12,5'. */
export function normalizeNumber(s: string): number | undefined {
  const m = s.replace(/[  ]/g, ' ').match(/-?\d[\d ,.]*/);
  if (!m) return undefined;
  let t = m[0].replace(/ /g, '').replace(/[.,]$/, '');
  if (t.includes(',') && t.includes('.')) t = t.replace(/,/g, '');
  else if (t.includes(',')) t = /,\d{3}(,|$)/.test(t) && !/,\d{1,2}$/.test(t) ? t.replace(/,/g, '') : t.replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

function lastNumber(s: string): number | undefined {
  const all = s.replace(/[  ]/g, ' ').match(/-?\d[\d ,.]*\d|-?\d/g);
  return all ? normalizeNumber(all[all.length - 1]!) : undefined;
}

export function parseJsonLoose(s: string): Record<string, unknown> | undefined {
  const m = s.match(/\{[\s\S]*\}/);
  if (!m) return undefined;
  try {
    const v = JSON.parse(m[0]);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

const near = (a: number | undefined, b: number) => a !== undefined && Math.abs(a - b) < 0.011;

export function grade(task: Task, raw: string): boolean {
  const out = stripThink(raw);
  switch (task.type) {
    case 'classify': {
      const found = LABELS.filter((l) => new RegExp(`\\b${l}\\b`, 'i').test(out));
      return found.length === 1 && found[0] === task.answer;
    }
    case 'extract': {
      const o = parseJsonLoose(out);
      const a = task.answer as Order;
      if (!o) return false;
      const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' ? normalizeNumber(v) : undefined);
      return (
        String(o.customer ?? '').trim().toLowerCase() === a.customer.toLowerCase() &&
        String(o.date ?? '').trim() === a.date &&
        near(num(o.amount), a.amount) &&
        String(o.currency ?? '').trim().toUpperCase() === a.currency &&
        num(o.items) === a.items
      );
    }
    case 'math':
      return near(lastNumber(out), task.answer as number);
    case 'qa':
      return typeof task.answer === 'number' ? near(lastNumber(out), task.answer) : out.toLowerCase().includes(String(task.answer).toLowerCase());
  }
}
