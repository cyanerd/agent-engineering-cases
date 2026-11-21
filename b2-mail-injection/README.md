# B2. Письмо-инъекция

Агент читает почтовый ящик и умеет выгружать клиентов. Корпус из 55 атак и 24 обычных писем, 6 профилей защиты, 3 модели, оракул по побочным эффектам.

- Отчёт: [REPORT.md](REPORT.md)
- Чек-лист: [CHECKLIST.md](CHECKLIST.md)
- Матрица: [results/summary.md](results/summary.md)

## Запуск

```bash
pnpm i
cp ../.env.example ../.env    # OPENCODE_API_KEY для облачных моделей; локальная - Ollama с qwen3:8b
pnpm --filter b2-mail-injection test                 # 58 тестов: мир, оракул, корпус, входной слой, политика, агент, метрики
pnpm --filter b2-mail-injection runs -- --models flash --pilot   # быстрый пилот
pnpm --filter b2-mail-injection runs -- --all                    # полный прогон (с прогретым кешем - без сети)
pnpm --filter b2-mail-injection report                           # results/summary.md и summary.csv
```

## Что где

- `src/corpus.ts` - письма; `src/world.ts`, `src/tools.ts` - мир и инструменты; `src/oracle.ts` - кто кому что отдал.
- `src/layers/` - вход (очистка, spotlighting), политика, аудит.
- `src/agent.ts`, `src/profiles.ts`, `src/prompts.ts` - агент и профили защиты.
- `results/<модель>/<профиль>.jsonl` - каждый прогон; `results/<модель>/traces/` - полные трассы всех утечек.
