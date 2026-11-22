# C1. Чужой хороший PR

Сервис отправки кодов с абстракцией SMS-провайдера, агентский PR, сконструированный PR с переписанным слоем и защиты процесса. Отчёт: [REPORT.md](REPORT.md).

## Запуск

```bash
pnpm i
pnpm --filter c1-agent-pr test       # тесты сервиса и pr-guard
pnpm --filter c1-agent-pr contract   # контрактные тесты слоя провайдеров
```

## Что где

- `src/` - сервис: `sender.ts`, провайдеры в `providers/`.
- `tests/` - исходные тесты «счастливого пути» и тесты `pr-guard`.
- `contract/` - контрактные тесты и фейковый провайдер: свойства, которые обязан сохранить любой рефакторинг.
- `scripts/pr-guard.ts` - проверки PR: критичные пути без авто-мержа, отметка ревью, лимит размера, scope.
- Задача агенту и журналы сессий - в ветках `c1/agent-delivery-status` (прогон 1, загрязнён, [PR #2](../docs/reviews/pr-02.md) закрыт) и `c1/agent-clean` (прогон 2, изолированный, [PR #5](../docs/reviews/pr-05.md)).
- [PR #3](../docs/reviews/pr-03.md) - переписанный слой, сконструирован вручную. Ветка - `c1/agent-refactor-constructed`. Прогоны CI до и после защит - в [evidence/ci-runs](evidence/ci-runs).
