# A3. Маршрутизатор моделей

480 задач с автоматической проверкой (классификация обращений, извлечение JSON, GSM8K, короткие ответы по тексту), ответы локальной `qwen3:8b` (с рассуждениями и без), `deepseek-v4.1-flash` и `deepseek-v4-pro`, политики маршрутизации, проверка не-худшести и расчёт теневого режима. Отчёт: [REPORT.md](REPORT.md), таблицы: [results/summary.md](results/summary.md).

## Запуск

```bash
pnpm i
pnpm --filter a3-router test                          # задачи, проверка ответов, роутер, статистика
pnpm --filter a3-router run runs -- --models qwen-fast,qwen,flash,pro   # ответы (кешируются), Ollama + ключ в .env
pnpm --filter a3-router run report        # results/summary.md, policies.csv, frontier.svg
A3_CHEAP=qwen3:8b pnpm --filter a3-router run report   # то же для рассуждающей дешёвой модели
```
