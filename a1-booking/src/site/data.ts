import { rng } from '../rng.ts';

export const LAYOUTS = ['main', 'swap', 'dateformat', 'rows', 'promo'] as const;
export type Layout = (typeof LAYOUTS)[number];
export const TODAY = '2026-11-21';

export interface Event { id: string; title: string; venue: string; priceFactor: number }
export interface Seat { row: number; seat: number; price: number; taken: boolean }
export interface Session { id: string; eventId: string; date: string; time: string; hall: string; seats: Seat[] }

const TITLES = ['Щелкунчик', 'Лебединое озеро', 'Ревизор', 'Вечер джаза', 'Три сестры', 'Органный концерт'];
const DATES = ['2026-11-28', '2026-11-29', '2026-12-05', '2026-12-06'];
const TIMES = ['12:00', '15:00', '19:00'];
export const ROWS = 12;
export const SEATS_PER_ROW = 16;

const basePrice = (row: number) => (row <= 3 ? 5000 : row <= 8 ? 3000 : 1500);

let cache: { events: Event[]; sessions: Session[] } | undefined;
export function catalog(): { events: Event[]; sessions: Session[] } {
  if (cache) return cache;
  const r = rng(2026);
  const events = TITLES.map((title, i) => ({ id: `e${i + 1}`, title, venue: i % 2 ? 'Малый зал' : 'Большой зал', priceFactor: [0.8, 1, 1.2, 1.4][i % 4]! }));
  const sessions: Session[] = [];
  for (const ev of events)
    for (const date of DATES)
      for (const time of TIMES) {
        if (r.next() < 0.35) continue;
        const seats: Seat[] = [];
        for (let row = 1; row <= ROWS; row++)
          for (let seat = 1; seat <= SEATS_PER_ROW; seat++)
            seats.push({ row, seat, price: Math.round((basePrice(row) * ev.priceFactor) / 100) * 100, taken: r.next() < 0.45 });
        sessions.push({ id: `s${sessions.length + 1}`, eventId: ev.id, date, time, hall: ev.venue, seats });
      }
  cache = { events, sessions };
  return cache;
}

const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
export function formatDate(iso: string, layout: Layout): string {
  const d = new Date(`${iso}T00:00:00Z`);
  // US numeric order on an otherwise Russian site: 12/05/2026 is the 5th of December.
  if (layout === 'dateformat') return `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;
  return `${WD[d.getUTCDay()]}, ${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
}
