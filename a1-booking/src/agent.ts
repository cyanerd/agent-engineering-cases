/**
 * Booking agent: an LLM with browser tools on the mock site. It stops at payment: pay() records that the agent
 * is ready to pay, the checks ladder decides what happens next (see ladder.ts).
 */
import type { ChatMessage, ChatRequest, ChatResult, Provider, ToolDef } from '@aec/llm';
import type { Browser, Page } from 'playwright';
import { freeText, type Case } from './intent.ts';
import type { Site } from './site/server.ts';

export const MAX_STEPS = 25;
export type InputMode = 'free' | 'schema';
export interface ModelRef { provider: Provider; model: string }
export interface LlmLike { chat(req: ChatRequest): Promise<ChatResult> }

export interface AgentRun {
  caseId: string;
  mode: InputMode;
  sample: number;
  paid: boolean;
  gaveUp?: string;
  steps: number;
  agentMs: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  error?: string;
  trace: string[];
}

const TOOLS: ToolDef[] = [
  { type: 'function', function: { name: 'snapshot', description: 'Return the page: its accessibility tree and the list of clickable elements with ref numbers and context (table row or group).', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'click', description: 'Click the element with this ref number from the latest snapshot.', parameters: { type: 'object', properties: { ref: { type: 'number' } }, required: ['ref'] } } },
  { type: 'function', function: { name: 'pay', description: 'Pay for the cart. Call only when the cart contains exactly what the user asked for.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'give_up', description: 'Stop without paying and explain why (e.g. the request cannot be fulfilled).', parameters: { type: 'object', properties: { reason: { type: 'string' } }, required: ['reason'] } } },
];

export const SYSTEM = `You are a ticket booking assistant working in a web browser on a ticket site.
Book exactly what the user asked for: the event, the date, the time, the number of tickets, seats in the requested rows, each ticket not above the price limit.
Use snapshot to see the page and click to act. When the cart contains exactly the requested tickets, call pay. If it is impossible, call give_up.
Do not click advertisements.`;

export function userMessage(c: Case, mode: InputMode): string {
  if (mode === 'free') return freeText(c.intent);
  const { eventTitle, date, time, qty, rowFrom, rowTo, maxPrice } = c.intent;
  return `Booking order (JSON, all fields are binding):\n${JSON.stringify({ event: eventTitle, date, time, qty, rows: [rowFrom, rowTo], maxPricePerTicket: maxPrice })}`;
}

/**
 * Page text for the model: the accessibility tree plus every clickable element with a ref number and its context
 * (the table row or group it sits in), like refs in Playwright MCP. Refs are reassigned on every snapshot.
 */
export async function snapshotText(page: Page): Promise<string> {
  const tree = await page.locator('body').ariaSnapshot();
  const items = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('a, button:not([disabled]), [role=button]'));
    return els.map((el, i) => {
      el.setAttribute('data-agent-ref', String(i + 1));
      const name = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ');
      const row = el.closest('tr');
      const group = el.closest('[role=group]');
      const aside = el.closest('aside');
      const ctx = row ? Array.from(row.querySelectorAll('td')).map((td) => td.textContent?.trim()).filter(Boolean).slice(0, 4).join(' | ') : group ? group.getAttribute('aria-label') ?? '' : aside ? aside.textContent?.trim().slice(0, 80) ?? '' : '';
      return `[ref=${i + 1}] ${el.tagName === 'A' && el.getAttribute('role') !== 'button' ? 'link' : 'button'} "${name}"${ctx ? ` - ${ctx}` : ''}`;
    });
  });
  return `URL: ${new URL(page.url()).pathname}\n${tree}\n\nClickable elements:\n${items.join('\n')}`.slice(0, 16_000);
}

async function doClick(page: Page, args: { ref?: number | string }): Promise<string> {
  const ref = Number(args.ref);
  if (!Number.isInteger(ref) || ref < 1) return 'Error: ref is required';
  const loc = page.locator(`[data-agent-ref="${ref}"]`);
  if ((await loc.count()) === 0) return `Error: no element with ref ${ref}; take a new snapshot`;
  await loc.first().click();
  await page.waitForLoadState('domcontentloaded');
  return `Clicked. ${await snapshotText(page)}`;
}

export async function runAgent(opts: { site: Site; browser: Browser; c: Case; mode: InputMode; sample: number; llm: LlmLike; model: ModelRef; runId: string }): Promise<AgentRun> {
  const { site, browser, c, mode, sample, llm, model, runId } = opts;
  const context = await browser.newContext();
  const page = await context.newPage();
  const started = performance.now();
  const run: AgentRun = { caseId: c.id, mode, sample, paid: false, steps: 0, agentMs: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, trace: [] };
  try {
    await page.goto(`${site.url}/?run=${encodeURIComponent(runId)}&layout=${c.layout}`);
    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `${userMessage(c, mode)}\n\nThe site is open. Current page:\n${await snapshotText(page)}` },
    ];
    loop: while (run.steps < MAX_STEPS) {
      const r = await llm.chat({ ...model, messages: [...messages], tools: TOOLS, temperature: 0.7, sample });
      run.steps++;
      run.inputTokens += r.usage.inputTokens;
      run.outputTokens += r.usage.outputTokens;
      run.costUsd += r.costUsd;
      const { reasoning_content: _r, ...msg } = r.message;
      messages.push(msg as ChatMessage);
      const calls = r.message.tool_calls ?? [];
      if (calls.length === 0) {
        messages.push({ role: 'user', content: 'Continue with the tools: pay when the cart is correct, or give_up.' });
        continue;
      }
      for (const call of calls) {
        let args: Record<string, string | number> = {};
        try {
          args = JSON.parse(call.function.arguments || '{}');
        } catch {}
        run.trace.push(`${call.function.name} ${JSON.stringify(args)}`);
        let out: string;
        if (call.function.name === 'snapshot') out = await snapshotText(page);
        else if (call.function.name === 'click') out = await doClick(page, args).catch((e: Error) => `Error: ${e.message.split('\n')[0]}`);
        else if (call.function.name === 'pay') {
          run.paid = true;
          break loop;
        } else if (call.function.name === 'give_up') {
          run.gaveUp = String(args.reason ?? '');
          break loop;
        } else out = `Error: unknown tool ${call.function.name}`;
        messages.push({ role: 'tool', tool_call_id: call.id, content: out });
      }
    }
  } catch (e) {
    run.error = (e as Error).message.slice(0, 300);
  } finally {
    run.agentMs = Math.round(performance.now() - started);
    await context.close();
  }
  return run;
}
