# wavecode

Браузерный AI-агент для live-coding музыки. Чистофронтовый SPA, без backend.

Агент на LLM (MiniMax через `llm.kosov.online`) правит score-файл —
JS-код со Strudel mini-notation — в реальном времени. Пользователь тоже
может писать/править; Strudel runtime в Web Worker пересчитывает паттерны,
Tone.js подаёт звук через колонки. Никаких серверов, кроме LLM-прокси.

## Архитектура

```
┌────────────────────────────────────────────────────┐
│ Browser (single SPA)                               │
│                                                    │
│  React UI ◄────► Agent (Effect-TS)                 │
│       │               │                            │
│       │               ▼                            │
│       │         LLM Client ────► llm.kosov.online  │
│       ▼                                             │
│  CodeMirror (Strudel mini-notation)               │
│       │                                             │
│       ▼                                             │
│  Strudel runtime (Web Worker) ──► Tone.js ──► audio│
└────────────────────────────────────────────────────┘
```

## Стек

- TypeScript (strict), Effect-TS, React 18, Zustand, CodeMirror 6
- `@strudel/core`, `@strudel/webaudio`, `@strudel/mini-notation`, `@strudel/tonal`,
  `@strudel/transpiler`, `@strudel/serialism`
- `tone` (Tone.js) для аудио-графа эффектов
- `@ai-sdk/openai-compatible` → `https://llm.kosov.online/v1`
- Тесты: vitest + playwright

## Структура

```
README.md
AGENTS.md
math/                     пакеты решений (math-coding)
ui/                       браузерный SPA
├── package.json
├── tsconfig.json
├── vite.config.ts
├── index.html
└── src/
    ├── domain/           чистые типы, схемы, функции
    ├── application/      use-cases: agentStep, editScore, evalPattern
    ├── infrastructure/   llm/, audio/, repo/, clock/
    └── presentation/     React-компоненты
```

## Решения

Каждое решение — пакет в `math/`:

| Пакет | Статус | Решение |
|---|---|---|
| `wavecode-scope` | draft | wavecode — чистофронтовый SPA, без backend |

## Старт (dev)

```sh
corepack enable
cd ui && pnpm install && pnpm dev    # http://localhost:5173
```

## Деплой

```sh
cd ui && pnpm build                  # → ui/dist/
# загрузить ui/dist/ на любой static-host
```

## Связь с Composer

**Никакой.** Composer — отдельный backend-проект в другом треде разработки.
Wavecode его не знает, не импортирует, не зависит от.