import { rng } from './rng.ts';

const CITIES = ['Казань', 'Самара', 'Пермь', 'Тула', 'Омск', 'Уфа'];
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const DAYS_IN = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export const QA_INSTRUCTION = 'Answer the question using only the text. Give the short answer only (a number or a name).';

/** 120 short questions over a paragraph: date differences, sums, comparisons, lookups with distractors. */
export function qaTasks(): { prompt: string; answer: number | string }[] {
  const r = rng(303);
  return Array.from({ length: 120 }, (_, i) => {
    const kind = i % 4;
    if (kind === 0) {
      const m = r.int(0, 10);
      const d1 = r.int(1, DAYS_IN[m]! - 3);
      const gap = r.int(2, 20);
      const d2raw = d1 + gap;
      const [m2, d2] = d2raw > DAYS_IN[m]! ? [m + 1, d2raw - DAYS_IN[m]!] : [m, d2raw];
      const text = `Заказ оформлен ${d1} ${MONTHS[m]} 2026 года, оплачен на следующий день, передан в доставку ${Math.min(d1 + 1, DAYS_IN[m]!)} ${MONTHS[m]}, а получен клиентом ${d2} ${MONTHS[m2]} 2026 года.`;
      return { prompt: `${text}\nВопрос: сколько дней прошло от оформления до получения?`, answer: gap };
    }
    if (kind === 1) {
      const [a, b, c] = [r.int(10, 400), r.int(10, 400), r.int(10, 400)];
      const [ca, cb, cc] = r.shuffle(CITIES).slice(0, 3);
      return { prompt: `За неделю склад в городе ${ca} отгрузил ${a} заказов, в городе ${cb} — ${b}, в городе ${cc} — ${c}. Возвратов было ${r.int(1, 9)}.\nВопрос: сколько заказов отгрузили все три склада вместе?`, answer: a + b + c };
    }
    if (kind === 2) {
      const cities = r.shuffle(CITIES).slice(0, 4);
      const vals = r.shuffle([r.int(50, 99), r.int(100, 149), r.int(150, 199), r.int(200, 260)]);
      const best = cities[vals.indexOf(Math.max(...vals))]!;
      const text = cities.map((c, j) => `${c}: ${vals[j]} обращений`).join('; ');
      return { prompt: `Статистика поддержки за месяц по городам — ${text}.\nВопрос: в каком городе было больше всего обращений?`, answer: best };
    }
    const price = r.int(100, 900);
    const qty = r.int(2, 9);
    const discount = r.pick([10, 20, 25, 50]);
    return { prompt: `Товар стоит ${price} рублей за штуку. Клиент купил ${qty} штук и применил промокод на скидку ${discount}% от общей суммы. Доставка бесплатная.\nВопрос: сколько рублей заплатил клиент?`, answer: Math.round(price * qty * (100 - discount)) / 100 };
  });
}
