# A2. Ночной watchdog

Симулятор истории прогонов с известной правдой, три механики отделения поломок от мигания и сравнение по 20 историям; живые мигающие Playwright-тесты для настоящих отпечатков. Отчёт: [REPORT.md](REPORT.md), таблица: [results/summary.md](results/summary.md).

## Запуск

```bash
pnpm i
pnpm --filter a2-watchdog test        # генератор, оценка, три детектора
pnpm --filter a2-watchdog run case    # подбор на неделях 1-2, сравнение на 3-4 -> results/summary.md
# живые мигающие тесты (нужен Chromium для Playwright; PW_CHROMIUM_PATH - путь к уже установленному)
pnpm --filter a2-watchdog run live -- --repeat-each=100
```
