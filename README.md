# wavecode

Браузерный AI-агент для live-coding музыки. Чистофронтовый SPA, без backend.

Агент на LLM (MiniMax через `llm.kosov.online`) правит score-файл —
JS-код со Strudel mini-notation — в реальном времени. Пользователь тоже
может писать/править; Strudel runtime в main thread пересчитывает паттерны
и играет через Web Audio API. Никаких серверов, кроме LLM-прокси.

## Архитектура

```
┌────────────────────────────────────────────────────┐
│ Browser (single SPA)                               │
│                                                    │
│  Solid UI ◄────► Effect Layer DI                   │
│       │               │                            │
│       │               ▼                            │
│       │         LLM Client ────► llm.kosov.online  │
│       ▼                                             │
│  CodeMirror (Strudel mini-notation)               │
│       │                                             │
│       ▼                                             │
│  @strudel/webaudio (evalScope + webaudioRepl)     │
│       │                                             │
│       ▼                                             │
│  Web Audio API → speakers                          │
└────────────────────────────────────────────────────┘
```

## Стек

- TypeScript (strict), Effect-TS, Solid.js 1.8, solid-js/store, CodeMirror 6
- `@strudel/core`, `@strudel/webaudio`, `@strudel/mini`, `@strudel/tonal`,
  `@strudel/transpiler`, `@strudel/serial`
- raw `fetch` → `https://llm.kosov.online/v1/chat/completions`
- `idb-keyval` для persistence (score + messages)
- Тесты: vitest + playwright

## Структура

```
README.md
AGENTS.md
math/                     пакеты решений (math-coding)
ui/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── index.html
└── src/
    ├── domain/           чистые типы, схемы, функции
    ├── application/      use-cases: llmEdit, editScore, buildUserPrompt, cleanLLMResponse
    ├── infrastructure/   llm/, audio/, repo/
    └── presentation/     Solid-компоненты
```

## Решения

Каждое решение — пакет в `math/` (полный список в
[`math/README.md`](math/README.md), 40+ пакетов).

| Пакет | Статус | Решение |
|---|---|---|
| `wavecode-scope` | draft | wavecode — чистофронтовый SPA, без backend |
| `wavecode-stack-performance` | draft | UI на Solid.js вместо React для max performance |
| `wavecode-strudel-in-browser` | applied | Audio через `@strudel/webaudio` (main thread) |
| `wavecode-effect-ts-architecture` | applied | Effect-TS как архитектурный рантайм (4 слоя + Layer DI) |
| `wavecode-codemirror-6` | applied | CodeMirror 6 для редактора (over Monaco) |
| `wavecode-llm-litellm-proxy` | applied | LLM через llm.kosov.online (LiteLLM), OpenAI-compatible |
| `wavecode-static-spa-deployment` | applied | Деплой как статический SPA, без Nix/Docker |
| `wavecode-test-strategy` | applied | vitest + playwright (пирамида) |
| `wavecode-strict-layering` | applied | ESLint no-restricted-imports per-layer |
| `wavecode-log-pipeline` | applied | `cleanLogArgs` + ring-buffer logger — strip Strudel `%c+CSS`, перехват console.* |
| `wavecode-debug-console` | applied | Toast + ConsoleButton + ConsoleSheet — error-button не auto-popup |
| `wavecode-piano-polyphony` | applied | Multi-note stack + 30ms debounce + note-off silence для on-screen piano |
| `wavecode-preset-decode-race` | applied | 7 пресетов n("name") → note("name") + await preload + concurrency 4 |

## Console UX

- Bottom-right FAB-кнопка `>_` всегда видна. Светится красным + pulse + бейдж
  unreadErrors, если есть непрочитанные ошибки. Клик → `ConsoleSheet` (bottom
  sheet, 60vh/90vh, вкладки Errors / All logs / By source, copy / clear).
- Critical / error события показываются как top popover (`Toast`); клик на
  поповер открывает ConsoleSheet с фильтром.
- Console сама **не** auto-popup'ится при ошибках.
- Log pipeline: `infrastructure/log/cleanLogArgs` strips Strudel-style
  `%c+background-color:...` из всех console вызовов; `infrastructure/log/logger`
  — ring buffer (500 записей) с source auto-detection
  (`[wavecode]`/`[strudel]`/`[sampler]`/`[cyclist]`/`[eval]`).

## Старт (dev)

```sh
cd ui && npm install && npm run dev   # http://localhost:5173
```

## Деплой

```sh
cd ui && npm run build                  # → ui/dist/
# загрузить ui/dist/ на любой static-host
```

## Связь с Composer

**Никакой.** Composer — отдельный backend-проект в другом треде разработки.
Wavecode его не знает, не импортирует, не зависит от.
