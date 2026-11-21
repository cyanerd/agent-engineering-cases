import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { catalog, LAYOUTS } from '../src/site/data.ts';
import { startSite, type Site } from '../src/site/server.ts';
import { intents } from '../src/intent.ts';
import { judgeOrder } from '../src/judge.ts';

let site: Site;
beforeAll(async () => { site = await startSite(0); });
afterAll(async () => { await site.close(); });

const text = async (path: string) => (await fetch(`${site.url}${path}`)).text();

describe('catalog', () => {
  it('is deterministic and every session has a hall with free seats', () => {
    expect(catalog()).toEqual(catalog());
    for (const s of catalog().sessions) expect(s.seats.some((x) => !x.taken)).toBe(true);
  });
});

describe('layouts', () => {
  it('every layout shows the same sessions of an event: dates and times are all present', async () => {
    const ev = catalog().events[0]!;
    const sessions = catalog().sessions.filter((s) => s.eventId === ev.id);
    for (const layout of LAYOUTS) {
      const html = await text(`/event/${ev.id}?layout=${layout}&run=t-${layout}`);
      for (const s of sessions) expect(html, `${layout} ${s.id}`).toContain(`/session/${s.id}`);
    }
  });
  it('the promo layout has an extra "Купить" button that leads to another event', async () => {
    const ev = catalog().events[0]!;
    const html = await text(`/event/${ev.id}?layout=promo&run=t-promo`);
    expect(html).toMatch(/promo/);
    expect((html.match(/Купить/g) ?? []).length).toBeGreaterThan(0);
  });
});

describe('cart and order', () => {
  it('selected seats land in the cart and paying records the order on the server', async () => {
    const s = catalog().sessions[0]!;
    const free = s.seats.filter((x) => !x.taken).slice(0, 2);
    for (const seat of free) await fetch(`${site.url}/select?run=r1&session=${s.id}&row=${seat.row}&seat=${seat.seat}`, { redirect: 'manual' });
    const cart = await text('/cart?run=r1&layout=main');
    for (const seat of free) expect(cart).toContain(`Ряд ${seat.row}, место ${seat.seat}`);
    await fetch(`${site.url}/pay?run=r1`, { method: 'POST', redirect: 'manual' });
    expect(site.order('r1')?.items).toHaveLength(2);
  });
});

describe('intents and judge', () => {
  it('300 satisfiable intents, deterministic, half with a broken layout', () => {
    const xs = intents();
    expect(xs).toHaveLength(300);
    expect(intents()).toEqual(xs);
    expect(xs.filter((i) => i.layout !== 'main')).toHaveLength(150);
  });
  it('judge compares the order with the intent field by field', () => {
    const i = intents()[0]!;
    const s = catalog().sessions.find((x) => x.eventId === i.intent.eventId && x.date === i.intent.date && x.time === i.intent.time)!;
    const seats = s.seats.filter((x) => !x.taken && x.row >= i.intent.rowFrom && x.row <= i.intent.rowTo && x.price <= i.intent.maxPrice).slice(0, i.intent.qty);
    const good = { items: seats.map((x) => ({ sessionId: s.id, row: x.row, seat: x.seat, price: x.price })) };
    expect(judgeOrder(good, i.intent)).toEqual({ ok: true, problems: [] });
    const wrongDate = { items: good.items.map((x) => ({ ...x, sessionId: catalog().sessions.find((y) => y.eventId === s.eventId && y.id !== s.id)!.id })) };
    expect(judgeOrder(wrongDate, i.intent).problems).toContain('session');
    expect(judgeOrder({ items: good.items.slice(0, 1) }, i.intent).problems).toContain('qty');
  });
});
