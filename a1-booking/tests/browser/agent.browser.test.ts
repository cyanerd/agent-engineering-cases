import type { ChatMessage, ChatRequest, ChatResult } from '@aec/llm';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runAgent } from '../../src/agent.ts';
import { intents } from '../../src/intent.ts';
import { judgeOrder } from '../../src/judge.ts';
import { catalog, formatDate } from '../../src/site/data.ts';
import { startSite, type Site } from '../../src/site/server.ts';

let site: Site;
let browser: Browser;
beforeAll(async () => {
  site = await startSite(0);
  browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
});
afterAll(async () => {
  await browser.close();
  await site.close();
});

/** A "model" that reads the latest page text and clicks the line matching each pattern in turn, then pays. */
function scripted(patterns: RegExp[]) {
  let i = 0;
  return {
    chat: async (r: ChatRequest): Promise<ChatResult> => {
      const last = [...r.messages].reverse().find((m) => m.role === 'tool' || m.role === 'user')!.content ?? '';
      const p = patterns[i++];
      const ref = p ? String(last).split('\n').find((l) => l.startsWith('[ref=') && p.test(l))?.match(/\[ref=(\d+)\]/)?.[1] : undefined;
      const call = p && ref ? { name: 'click', args: { ref: Number(ref) } } : p ? { name: 'give_up', args: { reason: `no line for ${p}` } } : { name: 'pay', args: {} };
      const message: ChatMessage = { role: 'assistant', content: null, tool_calls: [{ id: `c${i}`, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.args) } }] };
      return { message, usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 }, costUsd: 0, latencyMs: 1, cached: false, model: 'stub' };
    },
  };
}

describe('agent in a real browser', () => {
  it('a correct path through the refs ends with pay and an order that matches the intent', async () => {
    const c = intents().find((x) => x.layout === 'main')!;
    const s = catalog().sessions.find((x) => x.eventId === c.intent.eventId && x.date === c.intent.date && x.time === c.intent.time)!;
    const seats = s.seats.filter((x) => !x.taken && x.row >= c.intent.rowFrom && x.row <= c.intent.rowTo && x.price <= c.intent.maxPrice).slice(0, c.intent.qty);
    const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const run = await runAgent({
      site, browser, c, mode: 'schema', sample: 0, model: { provider: 'ollama', model: 'stub' }, runId: 'stub-1',
      llm: scripted([
        new RegExp(`link "${esc(c.intent.eventTitle)}"`),
        new RegExp(`Выбрать сеанс" - ${esc(formatDate(s.date, 'main'))} \\| ${esc(s.time)}`),
        ...seats.map((x) => new RegExp(`"Ряд ${x.row}, место ${x.seat}, ${x.price} ₽"`)),
        /link "Перейти в корзину"/,
      ]),
    });
    expect(run.paid, run.trace.join('\n')).toBe(true);
    await fetch(`${site.url}/pay?run=stub-1`, { method: 'POST', redirect: 'manual' });
    expect(judgeOrder(site.order('stub-1'), c.intent)).toEqual({ ok: true, problems: [] });
  });

  it('on the "rows" layout seat buttons carry no row number, but refs give the group as context', async () => {
    const c = intents().find((x) => x.layout === 'rows')!;
    const s = catalog().sessions.find((x) => x.eventId === c.intent.eventId && x.date === c.intent.date && x.time === c.intent.time)!;
    const seat = s.seats.find((x) => !x.taken && x.row === c.intent.rowFrom)!;
    const run = await runAgent({
      site, browser, c, mode: 'schema', sample: 0, model: { provider: 'ollama', model: 'stub' }, runId: 'stub-2',
      llm: scripted([new RegExp(`link "${c.intent.eventTitle}"`), new RegExp(`Выбрать сеанс" - ${formatDate(s.date, 'main').replace(/[.]/g, '\\.')} \\| ${s.time} \\|`), new RegExp(`"Место ${seat.seat}, ${seat.price} ₽" - Ряд ${seat.row}$`)]),
    });
    expect(run.trace).toHaveLength(4);
    expect(site.cart('stub-2')).toEqual([{ sessionId: expect.any(String), row: seat.row, seat: seat.seat, price: seat.price }]);
  });
});
