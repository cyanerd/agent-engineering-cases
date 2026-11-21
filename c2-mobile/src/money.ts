/** Kopecks to a Russian money string: 123456 -> "1 234,56 ₽". Integers only: no floating point for money. */
export function formatMoney(kopecks: number): string {
  if (!Number.isInteger(kopecks)) throw new Error('amount must be an integer number of kopecks');
  const sign = kopecks < 0 ? '−' : '';
  const abs = Math.abs(kopecks);
  const rub = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${sign}${rub},${String(abs % 100).padStart(2, '0')} ₽`;
}
