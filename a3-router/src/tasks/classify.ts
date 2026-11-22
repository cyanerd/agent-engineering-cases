import { rng } from './rng.ts';
import { LABELS, type Label } from './types.ts';

const CLEAR: Record<Label, string[]> = {
  billing: ['С карты списали деньги дважды за один заказ.', 'Не проходит оплата картой, пишет «отклонено банком».', 'Почему сумма в чеке больше, чем в корзине?', 'Нужен счёт на оплату для юрлица.', 'Списали подписку, хотя я её отключал.'],
  delivery: ['Курьер не приехал в назначенное время.', 'Заказ третий день «в пути», где он?', 'Можно перенести доставку на субботу?', 'Привезли не в тот пункт выдачи.', 'Трек-номер не отслеживается.'],
  refund: ['Хочу вернуть товар, он не подошёл по размеру.', 'Оформил возврат неделю назад, деньги так и не пришли.', 'Как вернуть деньги за отменённый заказ?', 'Пришёл брак, верните деньги.', 'Можно ли вернуть товар без чека?'],
  account: ['Не могу войти, код из СМС не приходит.', 'Как поменять номер телефона в профиле?', 'Удалите, пожалуйста, мой аккаунт.', 'Забыл пароль, восстановление не работает.', 'Кто-то зашёл в мой аккаунт с чужого устройства.'],
  bug: ['Приложение вылетает при открытии корзины.', 'Кнопка «Оформить заказ» не нажимается в Safari.', 'На странице товара бесконечная загрузка.', 'После обновления пропал список избранного.', 'Фильтр по цене показывает неправильные товары.'],
  other: ['Вы работаете в праздники?', 'Есть ли у вас вакансии?', 'Хочу предложить сотрудничество.', 'Спасибо, всё отлично, буду заказывать ещё!', 'Где ваш офис?'],
};
const TOPIC: Record<Label, string> = { billing: 'оплату', delivery: 'доставку', refund: 'возврат', account: 'вход в аккаунт', bug: 'ошибку на сайте', other: 'общий вопрос' };
const OPENERS = ['', 'Здравствуйте! ', 'Добрый день. ', 'Привет, ', 'Срочно! '];
const CLOSERS = ['', ' Спасибо.', ' Жду ответа.', ' Помогите, пожалуйста.'];

export const CLASSIFY_INSTRUCTION = `Classify the customer support message into exactly one category: ${LABELS.join(', ')}.
billing = payments, charges, invoices; delivery = shipping, couriers, tracking; refund = returns and money back; account = login, profile, account access; bug = the website or app does not work; other = anything else.
Answer with the category word only.`;

/** 120 tickets: 60 clear, 60 hard (negation, two intents with a stated main one, misleading keywords). */
export function classifyTasks(): { prompt: string; answer: Label }[] {
  const r = rng(101);
  const out: { prompt: string; answer: Label }[] = [];
  for (let i = 0; i < 60; i++) {
    const label = LABELS[i % 6]!;
    out.push({ prompt: `${r.pick(OPENERS)}${r.pick(CLEAR[label])}${r.pick(CLOSERS)}`, answer: label });
  }
  for (let i = 0; i < 60; i++) {
    const label = LABELS[i % 6]!;
    const decoy = r.pick(LABELS.filter((l) => l !== label));
    const kind = i % 3;
    const text =
      kind === 0
        ? `Вопрос не про ${TOPIC[decoy]}, с этим всё в порядке. ${r.pick(CLEAR[label])}`
        : kind === 1
          ? `${r.pick(CLEAR[decoy])} Но это мелочь, главное другое: ${r.pick(CLEAR[label]).toLowerCase()}`
          : `${r.pick(CLEAR[label])} (В прошлый раз писал вам про ${TOPIC[decoy]}, тот вопрос уже решён.)`;
    out.push({ prompt: `${r.pick(OPENERS)}${text}`, answer: label });
  }
  return out;
}
