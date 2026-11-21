# B1. Один телефон - пять компаний

Стенд: Keycloak 26.8.2 с собственным расширением входа по SMS + Postgres + API на TypeScript. Шесть сценариев «один номер в пяти компаниях» на наивной и исправленной модели.

Отчёт: [REPORT.md](REPORT.md). Результаты: [results/scenarios.json](results/scenarios.json).

## Запуск

Нужны Docker, Java 21 и Maven.

```bash
pnpm i
pnpm --filter b1-phone-orgs run case   # сборка расширения, чистый стек, все тесты стенда
pnpm --filter b1-phone-orgs run down   # остановить и удалить стек
```

Порты: Keycloak `localhost:18080` (админка `admin` / `admin-stand-only`), Postgres `localhost:15432`. Пароли - только для локального стенда.

## Что где

- `keycloak-sms/` - расширение Keycloak: выдача SMS-кода, аутентификатор direct grant по номеру и коду.
- `keycloak/realm-*.json` - два realm: `naive` и `fixed`.
- `db/001_app.sql` - схема приложения: люди, компании, членства, отзыв токенов, документы, версии, принятия.
- `src/api.ts` - API в двух вариантах; `src/seed.ts` - заведение людей.
- `tests/stand/` - тесты против поднятого стека: стек, SMS, API, сценарии S1-S6.
