import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { intents } from '../../src/intent.ts';
import { judgeOrder } from '../../src/judge.ts';
import { runScript } from '../../src/script-agent.ts';
import { catalog } from '../../src/site/data.ts';
import { startSite, type Site } from '../../src/site/server.ts';

let site: Site;
let browser: Browser;
beforeAll(async () => {
  site = await startSite(0);
  browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
});
afterAll(async () => {
  await browser?.close();
  await site?.close();
});

async function book(c: ReturnType<typeof intents>[number], runId: string) {
  const run = await runScript({ site, browser, c, runId });
  const order = { items: site.cart(runId) };
  return { run, judged: judgeOrder(order, c.intent) };
}

describe('brittle script', () => {
  it('books exactly the intent on the main layout', async () => {
    const c = intents().find((x) => x.layout === 'main')!;
    const { run, judged } = await book(c, 'script-main');
    expect(run.paid, run.gaveUp ?? run.error).toBe(true);
    expect(judged).toEqual({ ok: true, problems: [] });
  });

  it('on the promo layout takes the advertised row of another event when it has the same date and time', async () => {
    const { sessions } = catalog();
    const candidates = intents().filter((x) => {
      if (x.layout !== 'promo') return false;
      const first = sessions.find((s) => s.eventId === x.intent.eventId)!;
      return first.date === x.intent.date && first.time === x.intent.time;
    });
    expect(candidates.length).toBeGreaterThan(0);
    const results = [];
    for (const [i, c] of candidates.entries()) results.push(await book(c, `script-promo-${i}`));
    // Paid for another event's session in at least one case; never paid for the right one by luck.
    expect(results.some((r) => r.run.paid && r.judged.problems.includes('session'))).toBe(true);
    expect(results.filter((r) => r.run.paid).every((r) => !r.judged.ok)).toBe(true);
  });

  it('gives up instead of guessing when the date format is not dd.mm.yyyy', async () => {
    const c = intents().find((x) => x.layout === 'dateformat')!;
    const { run } = await book(c, 'script-dateformat');
    expect(run.paid).toBe(false);
    expect(run.gaveUp).toMatch(/no session row/);
  });
});
