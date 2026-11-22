# A1. Агент бронирует билеты

Локальный мок сайта-афиши с основной и четырьмя «сломанными» вёрстками. На нём работают LLM-агент в настоящем браузере (Playwright, клики по ref из дерева доступности) и, для сравнения, хрупкий скрипт без модели. Лестница проверок от «агент готов платить» до «у пользователя не те билеты». Отчёт: [REPORT.md](REPORT.md), таблица: [results/summary.md](results/summary.md).

## Запуск

```bash
pnpm i
pnpm --filter a1-booking test                 # сайт, намерения, лестница проверок
# браузерные тесты и прогоны (нужен Chromium для Playwright; PW_CHROMIUM_PATH - путь к уже установленному)
pnpm --filter a1-booking run test:browser
pnpm --filter a1-booking run runs             # агент на deepseek-v4.1-flash: 300 случаев x 2 режима ввода
pnpm --filter a1-booking run runs -- --script # хрупкий скрипт без модели
pnpm --filter a1-booking run report           # results/summary.md
pnpm --filter a1-booking run site             # сайт в браузере: http://127.0.0.1:4310/?layout=promo
```

Модель берётся из `A1_PROVIDER` и `A1_MODEL` (по умолчанию `opencode` и `deepseek-v4.1-flash`), ключ - в `.env` в корне.
