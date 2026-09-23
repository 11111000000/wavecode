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
| `wavecode-strudel-in-browser` | draft | none | Audio через Strudel+Web Audio, без Tidal+SuperDirt |
| `wavecode-effect-ts-architecture` | draft | none | Effect-TS как архитектурный рантайм (4 слоя + Layer DI) |
| `wavecode-codemirror-6` | draft | none | CodeMirror 6 для редактора (over Monaco) |
| `wavecode-llm-litellm-proxy` | draft | none | LLM через llm.kosov.online (LiteLLM), OpenAI-compatible |
| `wavecode-static-spa-deployment` | draft | none | Деплой как статический SPA, без Nix/Docker |
| `wavecode-test-strategy` | draft | none | vitest + playwright (пирамида) |
| `wavecode-strict-layering` | draft | none | ESLint no-restricted-imports per-layer |