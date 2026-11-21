/**
 * The ladder of checks between "the agent is ready to pay" and "the user has the wrong tickets".
 * Each step includes the previous ones. Step 1 (strict intent schema) changes the agent's input, so it is
 * measured by running the agent in 'schema' mode; here steps 0 and 1 apply the same post-hoc logic.
 */
import type { Intent } from './intent.ts';
import { judgeOrder } from './judge.ts';
import { catalog, TODAY } from './site/data.ts';
import type { Order } from './site/server.ts';

export const STEPS = [0, 1, 2, 3, 4, 5] as const;
export type Step = (typeof STEPS)[number];
/** Step 4 asks the user before any purchase above this total, even when every check passed. */
export const CONFIRM_ABOVE = 15_000;

export interface Recorded {
  intent: Intent;
  /** The cart page HTML as the site rendered it at payment time. */
  cartHtml: string;
  /** What the server would charge for (the cart at payment time). */
  order: Order;
  paid: boolean;
  mode: 'free' | 'schema';
}
export type Outcome = 'correct' | 'wrong_paid' | 'stopped' | 'cancelled' | 'not_done';
export interface LadderResult {
  outcome: Outcome;
  asked: boolean;
  /** Which step stopped or cancelled the purchase. */
  by?: string;
}

const MONTHS_EN: Record<string, string> = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };

export interface CartLine { title: string; date: string; time: string; row: number; seat: number; price: number }

/** Independent reader of the cart page: plain text parsing, nothing from the agent's reasoning. */
export function parseCartHtml(html: string): CartLine[] {
  const out: CartLine[] = [];
  for (const m of html.matchAll(/<li[^>]*>«([^»]+)», ([^<]+?) (\d{2}:\d{2}), Ряд (\d+), место (\d+) - (\d+) ₽<\/li>/g)) {
    const raw = m[2]!.trim();
    let date = '';
    const ru = raw.match(/(\d{2})\.(\d{2})\.(\d{4})/);
    const en = raw.match(/([A-Z][a-z]{2}) (\d{1,2})$/);
    if (ru) date = `${ru[3]}-${ru[2]}-${ru[1]}`;
    else if (en) date = `${TODAY.slice(0, 4)}-${MONTHS_EN[en[1]!]}-${en[2]!.padStart(2, '0')}`;
    out.push({ title: m[1]!.replace(/&quot;/g, '"').replace(/&amp;/g, '&'), date, time: m[3]!, row: Number(m[4]), seat: Number(m[5]), price: Number(m[6]) });
  }
  return out;
}

function invariantsOk(order: Order, i: Intent): boolean {
  const { sessions } = catalog();
  return (
    order.items.length === i.qty &&
    order.items.every((it) => it.price <= i.maxPrice && (sessions.find((s) => s.id === it.sessionId)?.date ?? '') >= TODAY)
  );
}

function cartMatches(lines: CartLine[], i: Intent): boolean {
  return (
    lines.length === i.qty &&
    lines.every((l) => l.title === i.eventTitle && l.date === i.date && l.time === i.time && l.row >= i.rowFrom && l.row <= i.rowTo && l.price <= i.maxPrice)
  );
}

export function evaluateLadder(r: Recorded, step: Step): LadderResult {
  if (!r.paid) return { outcome: 'not_done', asked: false };
  const correct = judgeOrder(r.order, r.intent).ok;
  if (step >= 2 && !invariantsOk(r.order, r.intent)) return { outcome: 'stopped', asked: true, by: 'invariants' };
  if (step >= 3 && !cartMatches(parseCartHtml(r.cartHtml), r.intent)) return { outcome: 'stopped', asked: true, by: 'cart-check' };
  const total = r.order.items.reduce((a, x) => a + x.price, 0);
  // The user confirms what the cart page shows; if the page itself is wrong, a human confirms the wrong thing too.
  const asked = step >= 4 && total > CONFIRM_ABOVE;
  if (correct) return { outcome: 'correct', asked };
  if (step >= 5) return { outcome: 'cancelled', asked, by: 'post-payment' };
  return { outcome: 'wrong_paid', asked };
}
