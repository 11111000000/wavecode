# Contributing to wavecode

> Спасибо за интерес к проекту! Ниже — короткий flow, который мы используем
> сами, и который должен работать и для внешних контрибьюторов.

[English version](#english-version-of-this-file) ниже.

## Workflow

1. **Fork** репозитория.
2. **Branch** от `master`:
   - `feat/<slug>` — новая фича
   - `fix/<slug>` — баг-фикс
   - `docs/<slug>` — только документация
   - `refactor/<slug>` — рефакторинг без изменения поведения
3. **Перед коммитом** — `bash scripts/pre-commit` (или `npm run precommit:install` для автоустановки hook'а).
4. **Commit messages** — Conventional Commits, English, ≤72 char subject. Пример: `fix(audio): respect LanguageMode in setScore hot-swap`.
5. **Push** в свой fork, откройте **PR** в `master`. CI гоняет typecheck + vitest + lint.
6. **Architectural decisions** — каждое нетривиальное изменение фиксируется YAML в `decisions/<id>.yaml` (math-coding 3.3 schema). Без этого PR может быть отклонён.

## Code style

- **TypeScript strict** — `strict: true` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`. Не подавляйте.
- **Layered architecture** — `ui/src/{domain,application,infrastructure,presentation}/`. Импорты между слоями enforced eslint'ом (`ui/eslint.config.js`). `console.*` в domain/application запрещён.
- **Tests** — пишите вместе с кодом. Unit на domain/application (без моков), infrastructure (с моками Layer), e2e на critical user-flows.
- **No `any`** — используйте `unknown` + zod-схему или Effect Schema.
- **Без комментариев без нужды** — комментарий должен объяснять *почему*, а не *что*. Код должен быть self-documenting.

## Что НЕ принимается

- Правки, ломающие layered architecture (импорт `solid-js` из `domain/`).
- Правки, добавляющие `console.log` в domain/application.
- Решения, не зафиксированные в `decisions/<id>.yaml` (для архитектурных изменений).
- Зависимости, не согласованные с maintainer'ом.
- Правки, ломающие public API без migration plan.

## Code review

Maintainer (Alexey Zhuravlev) делает review в течение 2-3 дней. Если за это время нет ответа — пинганите в PR. Approval требует:

- ✅ CI green (typecheck + vitest + lint)
- ✅ Pre-commit green
- ✅ Архитектурное решение задокументировано (если применимо)
- ✅ Скриншот/GIF для UI-изменений

## English version of this file

The same rules apply, in English:

1. **Fork** the repository.
2. **Branch** from `master`:
   - `feat/<slug>` — new feature
   - `fix/<slug>` — bug fix
   - `docs/<slug>` — documentation only
   - `refactor/<slug>` — refactor without behaviour change
3. **Before commit** — `bash scripts/pre-commit` (or `npm run precommit:install` to install the hook).
4. **Commit messages** — Conventional Commits, English, ≤72 char subject. Example: `fix(audio): respect LanguageMode in setScore hot-swap`.
5. **Push** to your fork, open a **PR** to `master`. CI runs typecheck + vitest + lint.
6. **Architectural decisions** — every non-trivial change is captured as YAML in `decisions/<id>.yaml` (math-coding 3.3 schema). Without this, the PR may be rejected.

### Code style

- **TypeScript strict** — `strict: true` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`. Don't suppress.
- **Layered architecture** — `ui/src/{domain,application,infrastructure,presentation}/`. Cross-layer imports are enforced by eslint (`ui/eslint.config.js`). `console.*` in domain/application is forbidden.
- **Tests** — write them with the code. Unit for domain/application (no mocks), infrastructure (with mocked Layers), e2e for critical user flows.
- **No `any`** — use `unknown` + zod schema or Effect Schema.
- **No comments unless necessary** — a comment must explain *why*, not *what*. Code should be self-documenting.

### What we don't accept

- Changes that break the layered architecture (importing `solid-js` from `domain/`).
- Changes that add `console.log` in domain/application.
- Decisions not captured in `decisions/<id>.yaml` (for architectural changes).
- Dependencies not approved by the maintainer.
- Changes that break the public API without a migration plan.

### Code review

The maintainer (Alexey Zhuravlev) reviews within 2-3 days. If there's no response in that window, ping in the PR. Approval requires:

- ✅ CI green (typecheck + vitest + lint)
- ✅ Pre-commit green
- ✅ Architectural decision documented (if applicable)
- ✅ Screenshot/GIF for UI changes
