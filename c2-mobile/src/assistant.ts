import { OPERATIONS, type Operation } from './data.ts';
import { formatMoney } from './money.ts';

/**
 * Read-only assistant on mocks. In the first release the agent can only answer questions about the
 * user's own data; it has no tools that move money. A real model would call these same read functions.
 */
export function answer(question: string, ops: Operation[] = OPERATIONS, today = '2026-11-21'): string {
  const q = question.toLowerCase();
  if (/перевед|переведи|отправ|оплат|заплати/.test(q)) return 'Я могу только показывать данные. Переводы и платежи делаются в разделе «Платежи» с подтверждением.';
  const since = (days: number) => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - days + 1);
    return d.toISOString().slice(0, 10);
  };
  const period = /недел/.test(q) ? 7 : /месяц/.test(q) ? 30 : undefined;
  if (/трат|расход|потратил/.test(q) && period) {
    const from = since(period);
    const spent = ops.filter((o) => o.date >= from && o.date <= today && o.amount < 0);
    const total = spent.reduce((s, o) => s + o.amount, 0);
    const byCat = new Map<string, number>();
    for (const o of spent) byCat.set(o.category, (byCat.get(o.category) ?? 0) + o.amount);
    const top = [...byCat.entries()].sort((a, b) => a[1] - b[1])[0];
    return `За ${period === 7 ? 'неделю' : 'месяц'} расходы ${formatMoney(-total)}${top ? `, больше всего - ${top[0]} (${formatMoney(-top[1])})` : ''}.`;
  }
  if (/баланс|сколько денег|остаток/.test(q)) return 'Баланс показан на экране «Счёт».';
  return 'Я умею отвечать про расходы за неделю или месяц. Например: «Сколько я потратил за неделю?»';
}
