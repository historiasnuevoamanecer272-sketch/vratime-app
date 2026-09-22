# Документация VratiMe

Эта папка — единый источник документации проекта. Если датированный handoff противоречит одному из основных документов ниже, приоритет имеет основной документ и фактическое состояние кода, миграций и production.

## Основные документы

- [PROJECT.md](PROJECT.md) — назначение, аудитория, принципы и границы продукта.
- [CURRENT_STATE.md](CURRENT_STATE.md) — актуальное состояние production, приложения, базы и релиза.
- [CHANGELOG.md](CHANGELOG.md) — история выпущенных пользовательских изменений.
- [ROADMAP.md](ROADMAP.md) — дальнейшие задачи и приоритеты.
- [DECISIONS.md](DECISIONS.md) — принятые продуктовые и технические решения с объяснением причин.
- [VRATIME_16_POINT_PLAN.md](VRATIME_16_POINT_PLAN.md) — утверждённый план развития и критерии приёмки релиза 22 сентября.

## Дизайн

- [design/VISUAL_SYSTEM.md](design/VISUAL_SYSTEM.md) — палитра, региональная идентичность и правила интерфейса.
- [design/ICONOGRAPHY.md](design/ICONOGRAPHY.md) — семантика и размещение пиктограмм.
- [design/IMAGE_STYLE_GUIDE.md](design/IMAGE_STYLE_GUIDE.md) — требования к растровым иллюстрациям.
- [design/VISUAL_QA_CHECKLIST.md](design/VISUAL_QA_CHECKLIST.md) — обязательная визуальная проверка.

## Эксплуатация

- [operations/ACCEPTANCE.md](operations/ACCEPTANCE.md) — приёмочные и security-проверки.
- [operations/SELF_HOSTING.md](operations/SELF_HOSTING.md) — публикация на собственном сервере.
- [operations/GOOGLE_OAUTH_SETUP.md](operations/GOOGLE_OAUTH_SETUP.md) — Google OAuth.
- [operations/AUTH_IDENTITY_CONTINUITY.md](operations/AUTH_IDENTITY_CONTINUITY.md) — непрерывность пользовательских учётных записей.
- [operations/MULTI_MESSENGERS_SETUP.md](operations/MULTI_MESSENGERS_SETUP.md) — несколько каналов связи.
- [operations/RELEASE_CANDIDATE_REPORT_2026-09-22.md](operations/RELEASE_CANDIDATE_REPORT_2026-09-22.md) — проверенный состав кандидата релиза и оставшиеся production-шаги.

## Архив

- `audits/` — датированные аудиты.
- `handoffs/` — снимки состояния для продолжения работы. Они сохраняют исторический контекст, но не являются актуальной спецификацией.

## Как поддерживать документы

1. После продуктового решения обновить `DECISIONS.md` и затронутые спецификации.
2. После пользовательского релиза добавить запись в `CHANGELOG.md`.
3. После деплоя обновить `CURRENT_STATE.md` точным commit/release ID.
4. Перенести выполненные задачи из `ROADMAP.md` в `CHANGELOG.md`.
5. Не хранить в документах пароли, API keys, access tokens или содержимое приватных ключей.
