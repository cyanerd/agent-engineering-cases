/**
 * A brittle booking script: classic browser automation without a model, written against the main layout.
 * It is the comparison point for "the site served a different layout": its assumptions are the ones such scripts
 * usually make, and the checks ladder is evaluated on its runs exactly as on the agent's.
 * Assumptions (all true on the main layout):
 * - a session is the first table row whose text has the date as dd.mm.yyyy and the time;
 * - a seat belongs to the row whose label "Ряд N" came last before it on the page;
 * - the seat's price is the number before "₽" in its label.
 */
import type { Browser } from 'playwright';
import type { AgentRun } from './agent.ts';
import type { Case } from './intent.ts';
import type { Site } from './site/server.ts';

export async function runScript(opts: { site: Site; browser: Browser; c: Case; runId: string }): Promise<AgentRun> {
  const { site, browser, c, runId } = opts;
  const { intent } = c;
  const run: AgentRun = { caseId: c.id, mode: 'schema', sample: 0, paid: false, steps: 0, agentMs: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, trace: [] };
  const started = performance.now();
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(`${site.url}/?run=${encodeURIComponent(runId)}&layout=${c.layout}`);
    await page.getByRole('link', { name: intent.eventTitle, exact: true }).click();
    run.steps++;
    const ruDate = `${intent.date.slice(8, 10)}.${intent.date.slice(5, 7)}.${intent.date.slice(0, 4)}`;
    const sessionHref = await page.evaluate(
      ({ ruDate, time }) => {
        for (const tr of Array.from(document.querySelectorAll('tbody tr'))) {
          const text = tr.textContent ?? '';
          if (text.includes(ruDate) && text.includes(time)) return tr.querySelector('a')?.getAttribute('href') ?? null;
        }
        return null;
      },
      { ruDate, time: intent.time },
    );
    if (!sessionHref) {
      run.gaveUp = `no session row with ${ruDate} ${intent.time}`;
      return run;
    }
    await page.goto(new URL(sessionHref, site.url).toString());
    run.steps++;
    const picks = await page.evaluate(
      ({ rowFrom, rowTo, maxPrice, qty }) => {
        let currentRow: number | undefined;
        const out: string[] = [];
        // Document order: labels and seat links as they appear on the page.
        for (const el of Array.from(document.querySelectorAll('span, a[role=button]'))) {
          const label = el.tagName === 'SPAN' ? el.textContent?.match(/^Ряд (\d+)$/) : null;
          if (label) {
            currentRow = Number(label[1]);
            continue;
          }
          if (el.tagName !== 'A' || el.closest('aside') || currentRow === undefined) continue;
          const price = Number((el.getAttribute('aria-label') ?? '').match(/(\d+) ₽/)?.[1] ?? Infinity);
          if (currentRow >= rowFrom && currentRow <= rowTo && price <= maxPrice && out.length < qty) out.push(el.getAttribute('href')!);
        }
        return out;
      },
      { rowFrom: intent.rowFrom, rowTo: intent.rowTo, maxPrice: intent.maxPrice, qty: intent.qty },
    );
    if (picks.length < intent.qty) {
      run.gaveUp = `found ${picks.length} of ${intent.qty} seats`;
      return run;
    }
    for (const href of picks) {
      await page.goto(new URL(href, site.url).toString());
      run.steps++;
    }
    run.paid = true;
    return run;
  } catch (e) {
    run.error = (e as Error).message.slice(0, 300);
    return run;
  } finally {
    run.agentMs = performance.now() - started;
    await context.close();
  }
}
