import type { Intent } from './intent.ts';
import { catalog } from './site/data.ts';
import type { Order } from './site/server.ts';

export type Problem = 'empty' | 'session' | 'qty' | 'row' | 'price' | 'duplicate';

/** Compares what was actually ordered on the server with the intent, field by field. */
export function judgeOrder(order: Order | undefined, intent: Intent): { ok: boolean; problems: Problem[] } {
  const problems = new Set<Problem>();
  const items = order?.items ?? [];
  if (items.length === 0) problems.add('empty');
  const { sessions } = catalog();
  for (const it of items) {
    const s = sessions.find((x) => x.id === it.sessionId);
    if (!s || s.eventId !== intent.eventId || s.date !== intent.date || s.time !== intent.time) problems.add('session');
    if (it.row < intent.rowFrom || it.row > intent.rowTo) problems.add('row');
    if (it.price > intent.maxPrice) problems.add('price');
  }
  if (items.length && items.length !== intent.qty) problems.add('qty');
  if (new Set(items.map((i) => `${i.sessionId}:${i.row}:${i.seat}`)).size !== items.length) problems.add('duplicate');
  return { ok: problems.size === 0, problems: [...problems] };
}
