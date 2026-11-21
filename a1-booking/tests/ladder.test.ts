import { describe, expect, it } from 'vitest';
import { intents } from '../src/intent.ts';
import { CONFIRM_ABOVE, evaluateLadder, parseCartHtml, STEPS } from '../src/ladder.ts';
import { catalog, formatDate } from '../src/site/data.ts';
import type { OrderItem } from '../src/site/server.ts';

const c = intents()[0]!;
const s = catalog().sessions.find((x) => x.eventId === c.intent.eventId && x.date === c.intent.date && x.time === c.intent.time)!;
const good: OrderItem[] = s.seats.filter((x) => !x.taken && x.row >= c.intent.rowFrom && x.row <= c.intent.rowTo && x.price <= c.intent.maxPrice).slice(0, c.intent.qty).map((x) => ({ sessionId: s.id, row: x.row, seat: x.seat, price: x.price }));
const otherSession = catalog().sessions.find((x) => x.eventId === s.eventId && x.id !== s.id)!;
const wrong: OrderItem[] = good.map((g) => ({ ...g, sessionId: otherSession.id }));
const html = (items: OrderItem[], layout: 'main' | 'dateformat') =>
  `<ul>${items.map((it) => { const ss = catalog().sessions.find((x) => x.id === it.sessionId)!; return `<li>«${catalog().events.find((e) => e.id === ss.eventId)!.title}», ${formatDate(ss.date, layout)} ${ss.time}, Ряд ${it.row}, место ${it.seat} - ${it.price} ₽</li>`; }).join('')}</ul>`;

describe('independent cart reader', () => {
  it('parses both date formats into the same items', () => {
    expect(parseCartHtml(html(good, 'main'))).toEqual(parseCartHtml(html(good, 'dateformat')));
    expect(parseCartHtml(html(good, 'main'))[0]).toMatchObject({ title: c.intent.eventTitle, date: c.intent.date, time: c.intent.time });
  });
});

describe('ladder', () => {
  const base = { intent: c.intent, cartHtml: html(good, 'main'), order: { items: good }, paid: true, mode: 'schema' as const };
  it('a correct cart passes every step; the user is asked only from step 4 and only above the confirmation threshold', () => {
    const total = good.reduce((a, x) => a + x.price, 0);
    for (const step of STEPS) expect(evaluateLadder(base, step), `step ${step}`).toMatchObject({ outcome: 'correct', asked: step >= 4 && total > CONFIRM_ABOVE });
  });
  it('a wrong session reaches the user at steps 0-2, is caught by the cart check from step 3 (asks the user), and is cancelled after payment at step 5', () => {
    const r = { ...base, cartHtml: html(wrong, 'main'), order: { items: wrong } };
    expect(evaluateLadder(r, 0).outcome).toBe('wrong_paid');
    expect(evaluateLadder(r, 2).outcome).toBe('wrong_paid');
    expect(evaluateLadder(r, 3)).toMatchObject({ outcome: 'stopped', asked: true });
    expect(evaluateLadder(r, 4)).toMatchObject({ outcome: 'stopped', asked: true });
  });
  it('a price above the limit is stopped by invariants (step 2) without reading the cart', () => {
    const pricey = good.map((g) => ({ ...g, price: c.intent.maxPrice + 100 }));
    expect(evaluateLadder({ ...base, cartHtml: html(pricey, 'main'), order: { items: pricey } }, 2)).toMatchObject({ outcome: 'stopped', asked: true });
  });
  it('step 4 asks the user before an expensive correct purchase; steps below do not', () => {
    const pricey = good.map((g) => ({ ...g, price: 9000 }));
    const r = { ...base, intent: { ...c.intent, maxPrice: 10_000, qty: pricey.length }, order: { items: pricey }, cartHtml: html(pricey, 'main') };
    const total = pricey.reduce((a, x) => a + x.price, 0);
    expect(evaluateLadder(r, 3)).toMatchObject({ outcome: 'correct', asked: false });
    expect(evaluateLadder(r, 4)).toMatchObject({ outcome: 'correct', asked: total > 15_000 });
  });
  it('step 5 catches a wrong order that the pre-payment checks missed (the cart page lied), by cancelling after payment', () => {
    const r = { ...base, cartHtml: html(good, 'main'), order: { items: wrong } };
    expect(evaluateLadder(r, 4).outcome).toBe('wrong_paid');
    expect(evaluateLadder(r, 5)).toMatchObject({ outcome: 'cancelled' });
  });
  it('a run that did not pay is "not_done", whatever the step', () => {
    expect(evaluateLadder({ ...base, paid: false }, 3).outcome).toBe('not_done');
  });
});
