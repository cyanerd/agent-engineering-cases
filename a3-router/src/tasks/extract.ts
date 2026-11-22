import { rng } from './rng.ts';

export interface Order {
  customer: string;
  date: string;
  amount: number;
  currency: 'RUB' | 'USD' | 'EUR';
  items: number;
}

const NAMES = ['Анна Орлова', 'Борис Петров', 'Вера Соколова', 'Глеб Тихонов', 'Дина Уварова', 'Егор Лапин', 'Жанна Котова', 'Илья Носов'];
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const NUM_WORDS = ['', 'одну', 'две', 'три', 'четыре', 'пять', 'шесть'];

export const EXTRACT_INSTRUCTION = `Extract the order from the text as JSON with exactly these fields:
{"customer": string (full name), "date": "YYYY-MM-DD", "amount": number (total, dot as decimal separator), "currency": "RUB" | "USD" | "EUR", "items": integer (number of items)}.
Answer with the JSON object only.`;

const thousands = (n: number, sep: string) => Math.trunc(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, sep);

function money(r: ReturnType<typeof rng>, amount: number, currency: Order['currency']): string {
  const cents = Math.round((amount % 1) * 100);
  const frac = cents ? `,${String(cents).padStart(2, '0')}` : '';
  const fracDot = cents ? `.${String(cents).padStart(2, '0')}` : '';
  if (currency === 'RUB') return r.pick([`${thousands(amount, ' ')}${frac} ₽`, `${thousands(amount, ' ')}${frac} руб.`, `${Math.trunc(amount)}${frac} рублей`]);
  if (currency === 'USD') return r.pick([`$${thousands(amount, ',')}${fracDot}`, `${thousands(amount, ' ')}${frac} долларов`]);
  return r.pick([`€${thousands(amount, ' ')}${frac}`, `${thousands(amount, ' ')}${frac} EUR`]);
}

/** 120 orders in free text with several date, money and quantity formats, plus distractor numbers. */
export function extractTasks(): { prompt: string; answer: Order }[] {
  const r = rng(202);
  return Array.from({ length: 120 }, (_, i) => {
    const day = r.int(1, 28);
    const month = r.int(1, 12);
    const year = r.pick([2025, 2026]);
    const currency = r.pick(['RUB', 'RUB', 'USD', 'EUR'] as const);
    const amount = currency === 'RUB' ? r.int(300, 250_000) + r.pick([0, 0, 0.5, 0.99, 0.25]) : r.int(5, 4000) + r.pick([0, 0.5, 0.99]);
    const items = r.int(1, 6);
    const customer = r.pick(NAMES);
    const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dateText = r.pick([`${day} ${MONTHS[month - 1]} ${year}`, `${String(day).padStart(2, '0')}.${String(month).padStart(2, '0')}.${year}`, iso]);
    const itemsText = r.pick([`${items} шт.`, `${items} позиц${items === 1 ? 'ию' : items < 5 ? 'ии' : 'ий'}`, `${NUM_WORDS[items]} ${items === 1 ? 'вещь' : items < 5 ? 'вещи' : 'вещей'}`]);
    const order = r.pick([`№${r.int(1000, 99999)}`, `#${r.int(100, 999)}-${r.int(10, 99)}`]);
    const templates = [
      `Заказ ${order} от ${dateText}. Покупатель: ${customer}. Состав: ${itemsText}. Итого к оплате ${money(r, amount, currency)}.`,
      `${customer} оформил(а) заказ ${order} ${dateText}: ${itemsText} на сумму ${money(r, amount, currency)}. Доставка в течение ${r.int(2, 9)} дней.`,
      `Добрый день! Подтверждаем заказ ${order}. Дата: ${dateText}. Клиент — ${customer}. Вы выбрали ${itemsText}, общая стоимость ${money(r, amount, currency)} (скидка ${r.int(3, 25)}% уже учтена).`,
    ];
    return { prompt: templates[i % 3]!.replace('руб..', 'руб.'), answer: { customer, date: iso, amount: Math.round(amount * 100) / 100, currency, items } };
  });
}
