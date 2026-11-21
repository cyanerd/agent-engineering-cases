# C2. Мобильное приложение без опыта

Спайк: PWA (React) → Capacitor 8 → Android и iOS, плюс биометрия, защищённое хранилище и защита экрана. Отчёт: [REPORT.md](REPORT.md), время по шагам: [TIMELOG.md](TIMELOG.md), скриншоты: [screenshots/](screenshots).

## Запуск

```bash
pnpm i
pnpm --filter c2-mobile test          # тесты формата денег и помощника
pnpm --filter c2-mobile build && cd c2-mobile && npx cap sync

# Android (нужны Android SDK и JDK 21)
cd android && JAVA_HOME=<путь к JDK 21> ./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk

# iOS (нужен Xcode)
cd ios/App && xcodebuild -project App.xcodeproj -scheme App -sdk iphonesimulator -destination 'name=iPhone 17 Pro' build

# Тестовая сборка с панелью проверок, которая сама прогоняет их при старте
pnpm build:selftest && npx cap sync
```
