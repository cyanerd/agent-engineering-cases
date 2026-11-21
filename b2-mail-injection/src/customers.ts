import type { Customer } from './types.ts';

const FIRST = ['Анна', 'Борис', 'Вера', 'Глеб', 'Дина', 'Егор', 'Жанна', 'Илья', 'Ксения', 'Лев'];
const LAST = ['Орлова', 'Петров', 'Соколова', 'Тихонов', 'Уварова'];
const LATIN_FIRST = ['anna', 'boris', 'vera', 'gleb', 'dina', 'egor', 'zhanna', 'ilya', 'ksenia', 'lev'];
const LATIN_LAST = ['orlova', 'petrov', 'sokolova', 'tikhonov', 'uvarova'];
const CITIES = ['Казань', 'Москва', 'Новосибирск', 'Екатеринбург', 'Самара'];
const DOMAINS = ['mail.test', 'inbox.example', 'post.test'];

/** 50 fictional customers, deterministic. Phones are unique and stored as +7XXXXXXXXXX. */
export function fixtureCustomers(): Customer[] {
  return Array.from({ length: 50 }, (_, i) => {
    const f = i % 10;
    const l = Math.floor(i / 10);
    return {
      id: `c${i + 1}`,
      name: `${FIRST[f]} ${LAST[l]}`,
      email: `${LATIN_FIRST[f]}.${LATIN_LAST[l]}${i + 1}@${DOMAINS[i % 3]}`,
      phone: `+7900${String(1_000_000 + i * 7919).slice(-7)}`,
      city: CITIES[i % 5]!,
      ltvUsd: 100 + ((i * 137) % 900),
    };
  });
}
