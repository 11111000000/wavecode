---
proposition: |
  Структурная целостность wavecode обеспечивается ESLint (flat config,
  v9) с правилом `no-restricted-imports` per-layer: domain не может
  импортить UI/audio/AI/DB; application не может импортить UI/audio/AI/DB;
  infrastructure не может импортить UI; presentation не может импортить
  audio/AI/DB напрямую.
antithesis: |
  ESLint — лишний overhead для небольшого проекта; правила можно нарушить
  через `// eslint-disable-next-line`. Альтернатива — TypeScript-only
  брэнд-типы или архитектурные тесты (dependency-cruiser), но это
  дополнительная сложность. Strict layering может мешать быстрому
  прототипированию.
synthesis: |
  Strict layering предотвращает «гниение архитектуры»: domain остаётся
  pure (тестируется без моков), application оркестрирует через Effect,
  infrastructure инкапсулирует IO, presentation только отображает. Это
  даёт testability и чистую заменяемость (например, swap AudioEngine
  impl не ломает domain). ESLint enforcement в CI не даёт нарушить
  случайно. Цена: occasional `// eslint-disable-next-line` для
  оправданных случаев.
substrate: none
status: draft
axiom: A5
epistemics:
  - statement: "Layer separation даёт testability и заменяемость"
  - statement: "ESLint no-restricted-imports запрещает cross-layer dependencies"
    marker: fact
    evidence: "ui/eslint.config.js — 4 override-блока для domain/application/infrastructure/presentation"
---

## Intent

ESLint (flat config v9) проверяет, что импорты между слоями не нарушают
архитектуру. Запускается в CI как `pnpm lint`. Failure = не mergeable.

## What this is NOT

- Не TypeScript-only strict mode (не запрещает импорты между слоями).
- Не dependency-cruiser (отдельный инструмент, дополнительная сложность).
- Не jest-тесты на структуру (медленнее, не интегрируется с редактором).

## Worked example

```js
// ui/eslint.config.js (упрощённо)
export default [
  // ... base config
  {
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['solid-js', '@solidjs/*'], message: 'domain не должен знать про UI' },
          { group: ['@strudel/*', 'tone'], message: 'domain не должен знать про аудио' },
          { group: ['@ai-sdk/*', 'ai'], message: 'domain не должен знать про AI SDK' },
          { group: ['idb-keyval'], message: 'domain не должен знать про IndexedDB' },
        ],
      }],
    },
  },
  // ... аналогично для application, infrastructure, presentation
];
```

## Notes

- 4 override-блока в `ui/eslint.config.js`:
  - `domain/**` — нет solid-js, @strudel, @ai-sdk, idb-keyval, @effect/platform
  - `application/**` — нет solid-js, @strudel, @ai-sdk, idb-keyval
  - `infrastructure/**` — нет solid-js
  - `presentation/**` — нет @strudel, @ai-sdk, idb-keyval
- Опциональные исключения — через `// eslint-disable-next-line` с комментарием.
- CI: `pnpm lint && pnpm test:run && pnpm test:e2e && pnpm build`.