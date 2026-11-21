export interface Operation {
  id: string;
  date: string;
  title: string;
  category: 'продукты' | 'транспорт' | 'кафе' | 'зарплата' | 'переводы' | 'связь';
  /** Kopecks; negative = spending. */
  amount: number;
}

export const BALANCE = 18_452_315;

export const OPERATIONS: Operation[] = [
  { id: 'o1', date: '2026-11-21', title: 'Продуктовый у дома', category: 'продукты', amount: -184_590 },
  { id: 'o2', date: '2026-11-20', title: 'Метро', category: 'транспорт', amount: -6_400 },
  { id: 'o3', date: '2026-11-20', title: 'Кофейня', category: 'кафе', amount: -34_000 },
  { id: 'o4', date: '2026-11-19', title: 'Зарплата', category: 'зарплата', amount: 12_500_000 },
  { id: 'o5', date: '2026-11-18', title: 'Перевод Анне', category: 'переводы', amount: -500_000 },
  { id: 'o6', date: '2026-11-17', title: 'Мобильная связь', category: 'связь', amount: -65_000 },
  { id: 'o7', date: '2026-11-16', title: 'Супермаркет', category: 'продукты', amount: -312_780 },
  { id: 'o8', date: '2026-11-15', title: 'Такси', category: 'транспорт', amount: -48_900 },
  { id: 'o9', date: '2026-11-14', title: 'Обед', category: 'кафе', amount: -52_000 },
  { id: 'o10', date: '2026-11-10', title: 'Супермаркет', category: 'продукты', amount: -201_350 },
];
