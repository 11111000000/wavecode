# math/ — пакеты решений

Здесь живут пакеты math-coding v1.0: `math/<name>/packet.md` + `witness`.

Схема — в [math-coding/AGENTS.md](../math-coding/AGENTS.md) (бинарь
`math-coding` сломан, CLI `create/apply` не работают; пишем вручную).

## Lifecycle (вычисляется из git-истории)

| Состояние | Условие |
|---|---|
| `draft` | пакет создан, нет файла `witness` |
| `applied` | пакет + `witness` в git, proposition не менялся |
| `drift` | witness есть, но proposition изменился |
| `stale` | witness + файлы изменились, proposition тот же |
| `retired` | явный `retire` (supersession или deprecation) |
| `abandoned` | явный `abandon` |

## Список пакетов

| Пакет | Статус | Substrate | Решение |
|---|---|---|---|
| `wavecode-scope` | draft | none | wavecode — чистофронтовый SPA, без backend |
| `wavecode-stack-performance` | draft | none | UI на Solid.js вместо React для max performance |
| `wavecode-strudel-in-browser` | applied | none | Audio через `@strudel/webaudio` (main thread, webaudioRepl) |
| `wavecode-effect-ts-architecture` | applied | none | Effect-TS как архитектурный рантайм (4 слоя + Layer DI) |
| `wavecode-codemirror-6` | applied | none | CodeMirror 6 для редактора (over Monaco) |
| `wavecode-llm-litellm-proxy` | applied | none | LLM через llm.kosov.online (LiteLLM), raw fetch |
| `wavecode-llm-cors-explicit-allowlist` | draft | 3 files (cross-repo) | Explicit finite allowlist в `services.llm-proxy.publicInstance.corsAllowedOrigins`; wavecode добавлен в список. Попутно убран дубль `console.log` в `LiveLLMClient.ts`. |
| `wavecode-static-spa-deployment` | applied | none | Деплой как статический SPA, без Nix/Docker |
| `wavecode-test-strategy` | applied | none | vitest + playwright (пирамида) |
| `wavecode-strict-layering` | applied | none | ESLint no-restricted-imports per-layer |
