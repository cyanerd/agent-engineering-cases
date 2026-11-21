/** Mock ticket site. State per run id: layout, cart, order. Every layout shows the same data differently. */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { catalog, formatDate, LAYOUTS, ROWS, type Layout, type Session } from './data.ts';

export interface OrderItem { sessionId: string; row: number; seat: number; price: number }
export interface Order { items: OrderItem[] }
interface RunState { layout: Layout; cart: OrderItem[]; order?: Order }
export interface Site { url: string; order(run: string): Order | undefined; cart(run: string): OrderItem[]; close(): Promise<void> }

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const page = (title: string, body: string) => `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>${esc(title)}</title></head><body>${body}</body></html>`;

export async function startSite(port: number): Promise<Site> {
  const runs = new Map<string, RunState>();
  const { events, sessions } = catalog();
  const state = (run: string, layout?: string): RunState => {
    let s = runs.get(run);
    if (!s) runs.set(run, (s = { layout: (LAYOUTS as readonly string[]).includes(layout ?? '') ? (layout as Layout) : 'main', cart: [] }));
    return s;
  };
  const q = (run: string) => `run=${encodeURIComponent(run)}`;
  const eventOf = (s: Session) => events.find((e) => e.id === s.eventId)!;

  function promo(run: string, exclude: string): string {
    const other = sessions.find((s) => s.eventId !== exclude && s.time === '19:00')!;
    return `<aside class="promo" aria-label="Реклама"><strong>Хит продаж!</strong> «${esc(eventOf(other).title)}» ${formatDate(other.date, 'main')} ${other.time} - осталось мало мест. <a href="/session/${other.id}?${q(run)}">Купить</a></aside>`;
  }

  function home(run: string, st: RunState): string {
    return page('Афиша', `<h1>Афиша</h1>${st.layout === 'promo' ? promo(run, '') : ''}<ul>${events.map((e) => `<li><a href="/event/${e.id}?${q(run)}">${esc(e.title)}</a> - ${esc(e.venue)}</li>`).join('')}</ul>`);
  }

  function eventPage(run: string, st: RunState, id: string): string {
    const ev = events.find((e) => e.id === id);
    if (!ev) return page('Нет такого события', '<h1>Нет такого события</h1>');
    const list = sessions.filter((s) => s.eventId === id);
    const swap = st.layout === 'swap';
    const head = swap ? '<th>Время</th><th>Дата</th>' : '<th>Дата</th><th>Время</th>';
    const rows = list
      .map((s) => {
        const from = Math.min(...s.seats.filter((x) => !x.taken).map((x) => x.price));
        const d = `<td>${formatDate(s.date, st.layout)}</td>`;
        const t = `<td>${s.time}</td>`;
        return `<tr>${swap ? t + d : d + t}<td>${esc(s.hall)}</td><td>от ${from} ₽</td><td><a href="/session/${s.id}?${q(run)}">Выбрать сеанс</a></td></tr>`;
      })
      .join('');
    return page(ev.title, `<h1>${esc(ev.title)}</h1>${st.layout === 'promo' ? promo(run, id) : ''}<table><thead><tr>${head}<th>Зал</th><th>Цена</th><th></th></tr></thead><tbody>${rows}</tbody></table><p><a href="/?${q(run)}">К афише</a></p>`);
  }

  function hallPage(run: string, st: RunState, id: string): string {
    const s = sessions.find((x) => x.id === id);
    if (!s) return page('Нет такого сеанса', '<h1>Нет такого сеанса</h1>');
    const ev = eventOf(s);
    const order = st.layout === 'rows' ? Array.from({ length: ROWS }, (_, i) => ROWS - i) : Array.from({ length: ROWS }, (_, i) => i + 1);
    const rowsHtml = order
      .map((row) => {
        const seats = s.seats
          .filter((x) => x.row === row)
          .map((x) => {
            const label = st.layout === 'rows' ? `Место ${x.seat}, ${x.price} ₽` : `Ряд ${row}, место ${x.seat}, ${x.price} ₽`;
            return x.taken ? `<button disabled aria-label="${label}, занято">${x.seat}</button>` : `<a role="button" aria-label="${label}" href="/select?${q(run)}&session=${s.id}&row=${row}&seat=${x.seat}">${x.seat}</a>`;
          })
          .join(' ');
        const name = `Ряд ${row}`;
        return st.layout === 'rows' ? `<div role="group" aria-label="${name}">${seats} <span>${name}</span></div>` : `<div role="group" aria-label="${name}"><span>${name}</span> ${seats}</div>`;
      })
      .join('');
    const promoSeats = st.layout === 'promo' ? `<aside class="promo" aria-label="Реклама">Лучшие места в партере! <a href="/select?${q(run)}&session=${s.id}&row=1&seat=${s.seats.find((x) => x.row === 1 && !x.taken)?.seat ?? 1}">Купить</a></aside>` : '';
    const sel = st.cart.filter((c) => c.sessionId === s.id).length;
    return page(`${ev.title} - зал`, `<h1>${esc(ev.title)}</h1><p>${formatDate(s.date, st.layout)}, ${s.time}, ${esc(s.hall)}</p>${promoSeats}<p>Цены: 1-3 ряд, 4-8 ряд, 9-12 ряд - по зонам. Сцена ${st.layout === 'rows' ? 'внизу' : 'вверху'}.</p>${rowsHtml}<p>Выбрано мест: ${sel}. <a href="/cart?${q(run)}">Перейти в корзину</a> · <a href="/reset?${q(run)}&session=${s.id}">Сбросить выбор</a> · <a href="/event/${s.eventId}?${q(run)}">Другой сеанс</a></p>`);
  }

  function cartPage(run: string, st: RunState): string {
    const items = st.cart
      .map((c, i) => {
        const s = sessions.find((x) => x.id === c.sessionId)!;
        return `<li data-item="${i}">«${esc(eventOf(s).title)}», ${formatDate(s.date, st.layout)} ${s.time}, Ряд ${c.row}, место ${c.seat} - ${c.price} ₽</li>`;
      })
      .join('');
    const total = st.cart.reduce((a, c) => a + c.price, 0);
    return page('Корзина', `<h1>Корзина</h1><ul>${items || '<li>Пусто</li>'}</ul><p>Итого: ${total} ₽</p><form method="post" action="/pay?${q(run)}"><button type="submit">Оплатить</button></form><p><a href="/?${q(run)}">К афише</a></p>`);
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const u = new URL(req.url ?? '/', 'http://x');
    const run = u.searchParams.get('run') ?? 'default';
    const st = state(run, u.searchParams.get('layout') ?? undefined);
    const html = (b: string) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(b);
    };
    const redirect = (to: string) => {
      res.writeHead(303, { location: to });
      res.end();
    };
    let m: RegExpMatchArray | null;
    if (u.pathname === '/') return html(home(run, st));
    if ((m = u.pathname.match(/^\/event\/(e\d+)$/))) return html(eventPage(run, st, m[1]!));
    if ((m = u.pathname.match(/^\/session\/(s\d+)$/))) return html(hallPage(run, st, m[1]!));
    if (u.pathname === '/select') {
      const sid = u.searchParams.get('session')!;
      const row = Number(u.searchParams.get('row'));
      const seat = Number(u.searchParams.get('seat'));
      const s = sessions.find((x) => x.id === sid);
      const x = s?.seats.find((y) => y.row === row && y.seat === seat);
      if (s && x && !x.taken && !st.cart.some((c) => c.sessionId === sid && c.row === row && c.seat === seat)) st.cart.push({ sessionId: sid, row, seat, price: x.price });
      return redirect(`/session/${sid}?${q(run)}`);
    }
    if (u.pathname === '/reset') {
      st.cart = st.cart.filter((c) => c.sessionId !== u.searchParams.get('session'));
      return redirect(`/session/${u.searchParams.get('session')}?${q(run)}`);
    }
    if (u.pathname === '/cart') return html(cartPage(run, st));
    if (u.pathname === '/pay' && req.method === 'POST') {
      st.order = { items: [...st.cart] };
      return redirect(`/ticket?${q(run)}`);
    }
    if (u.pathname === '/ticket') return html(page('Билет', `<h1>Оплачено</h1><p>Мест: ${st.order?.items.length ?? 0}</p>`));
    res.writeHead(404);
    res.end('not found');
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((e) => {
      res.writeHead(500);
      res.end(String(e));
    });
  });
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
  const { port: actual } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${actual}`,
    order: (run) => runs.get(run)?.order,
    cart: (run) => runs.get(run)?.cart ?? [],
    close: () => new Promise((r) => server.close(() => r())),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const s = await startSite(Number(process.env.PORT ?? 4310));
  console.log(`site on ${s.url}`);
}
