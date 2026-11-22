import { rng } from './rng.ts';
import { catalog, LAYOUTS, type Layout } from './site/data.ts';

export interface Intent {
  eventId: string;
  eventTitle: string;
  date: string;
  time: string;
  qty: number;
  rowFrom: number;
  rowTo: number;
  maxPrice: number;
}
export interface Case { id: string; layout: Layout; intent: Intent }

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const WD_ACC = ['в воскресенье', 'в понедельник', 'во вторник', 'в среду', 'в четверг', 'в пятницу', 'в субботу'];

/** 300 satisfiable intents; even ones on the main layout, odd ones on the four broken layouts in turn. */
export function intents(): Case[] {
  const { events, sessions } = catalog();
  const r = rng(77);
  const out: Case[] = [];
  const zones: [number, number][] = [[1, 3], [4, 8], [9, 12], [5, 7], [2, 5], [6, 6]];
  while (out.length < 300) {
    const s = r.pick(sessions);
    const [rowFrom, rowTo] = r.pick(zones);
    const qty = r.int(1, 3);
    const inZone = s.seats.filter((x) => !x.taken && x.row >= rowFrom && x.row <= rowTo);
    if (inZone.length < qty) continue;
    const maxPrice = Math.max(...inZone.map((x) => x.price)) + r.pick([0, 200, 500]);
    const i = out.length;
    const layout: Layout = i % 2 === 0 ? 'main' : LAYOUTS[1 + (((i - 1) / 2) % 4)]!;
    out.push({ id: `c${String(i + 1).padStart(3, '0')}`, layout, intent: { eventId: s.eventId, eventTitle: events.find((e) => e.id === s.eventId)!.title, date: s.date, time: s.time, qty, rowFrom, rowTo, maxPrice } });
  }
  return out;
}

export function freeText(i: Intent): string {
  const d = new Date(`${i.date}T00:00:00Z`);
  const n = i.qty === 1 ? 'один билет' : i.qty === 2 ? 'два билета' : 'три билета';
  const rows = i.rowFrom === i.rowTo ? `${i.rowFrom} ряд` : `ряды с ${i.rowFrom} по ${i.rowTo}`;
  return `Купи ${n} на «${i.eventTitle}» ${WD_ACC[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} на ${i.time}, ${rows}, не дороже ${i.maxPrice} ₽ за билет.`;
}
