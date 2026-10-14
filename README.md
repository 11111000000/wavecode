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
math/                     legacy пакеты решений math-coding v1.0 (87 шт.)
decisions/                решения math-coding 3.3 (active source of truth)
attestations/             attestation store (kernel evidence для self-check)
schemas/                  JSON-schema reference (math-coding 3.3 kernel input)
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

Каждое решение — файл в `decisions/<id>.yaml` (math-coding 3.3 schema).
Полный список: `mathc packages` или `ls decisions/*.yaml`.
Подробнее — в [AGENTS.md](AGENTS.md).

| Решение | Статус | Резюме |
|---|---|---|
| `wavecode-scope` | active | wavecode — чистофронтовый SPA, без backend |
| `wavecode-stack-performance` | active | UI на Solid.js вместо React для max performance |
| `wavecode-strudel-in-browser` | active | Audio через `@strudel/webaudio` (main thread) |
| `wavecode-effect-ts-architecture` | active | Effect-TS как архитектурный рантайм (4 слоя + Layer DI) |
| `wavecode-codemirror-6` | active | CodeMirror 6 для редактора (over Monaco) |
| `wavecode-llm-litellm-proxy` | active | LLM через llm.kosov.online (LiteLLM), OpenAI-compatible |
| `wavecode-static-spa-deployment` | active | Деплой как статический SPA, без Nix/Docker |
| `wavecode-test-strategy` | active | vitest + playwright (пирамида) |
| `wavecode-strict-layering` | active | ESLint no-restricted-imports per-layer |
| `wavecode-log-pipeline` | active | `cleanLogArgs` + ring-buffer logger — strip Strudel `%c+CSS`, перехват console.* |
| `wavecode-debug-console` | active | Toast + ConsoleButton + ConsoleSheet — error-button не auto-popup |
| `wavecode-piano-polyphony` | active | Multi-note stack + 30ms debounce + note-off silence для on-screen piano |
| `wavecode-preset-decode-race` | active | 7 пресетов n("name") → note("name") + await preload + concurrency 4 |
| `wavecode-logger-enhancements` | active | `fatal` level + per-source throttle (5/1s) + IDB-persisted last-100 errors |
| `console-ux-polish`¹ | active | fatal severity + color-blind SVG icons + Cmd/Ctrl+` hotkey |
| `wavecode-quality-tooling` | active | `no-console` lint в domain/application + `validate:presets` + pre-commit hook |

¹ outlier без `wavecode-` префикса — legacy id из v1.0 (см. PR
`feat/math-coding-3.3-upgrade`).

## Console UX

- Bottom-right FAB-кнопка `>_` всегда видна. Светится красным + pulse + бейдж
  unreadErrors, если есть непрочитанные ошибки. Клик → `ConsoleSheet` (bottom
  sheet, 60vh/90vh, вкладки Errors / All logs / By source, copy / clear).
- **Cmd/Ctrl+`** (backtick) — глобальный hotkey toggle'ит ConsoleSheet.
  Suppressed в INPUT/TEXTAREA/contenteditable (чтобы не конфликтовать с
  typing в CodeMirror). ConsoleButton `title` показывает платформенный
  хинт (`Cmd+`` на Mac, `Ctrl+`` elsewhere). Phase 2.
- Critical / error / **fatal** события показываются как top popover (`Toast`);
  клик на поповер открывает ConsoleSheet с фильтром. `'fatal'` LogLevel
  (Phase 2 logger) → sticky toast та же семантика, что critical.
- Каждый Toast рендерит leading SVG-иконку (`InfoIcon` / `WarnIcon` /
  `ErrorIcon` / `CriticalIcon`) — shape-канал для color-blind
  (WCAG 1.4.1). Border color остаётся second channel. Phase 2.
- Console сама **не** auto-popup'ится при ошибках.
- Log pipeline: `infrastructure/log/cleanLogArgs` strips Strudel-style
  `%c+background-color:...` из всех console вызовов; `infrastructure/log/logger`
  — ring buffer (500 записей) с source auto-detection
  (`[wavecode]`/`[strudel]`/`[sampler]`/`[cyclist]`/`[eval]`).
- **Per-source throttle** для warn / error / fatal (5 emits / source / 1000ms
  window). При burst'е 6+ одинаковых сообщений из одного source'а — single
  warn-level drop entry: `"[N similar messages suppressed in the last 1s]"`.
  `info` / `debug` НЕ throttle'ятся. Phase 2.
- **IDB-персистентность** последних 100 error/fatal записей под ключом
  `'wavecode:console:errors'`. Переживают reload. `idb-keyval`
  dynamic-import (graceful no-op когда недоступен). Phase 2.
- TabBar показывает **"Загружено N/M семплов"** progress pill во время
  preload (слушает `'wavecode:sample-progress'` CustomEvent от
  `SampleLoader`). Скрывается когда `status: 'loaded'`. Phase 2.
- **ServiceWorker cache pre-check** в `SampleLoader.preloadAllBuffers`:
  URL'ы уже в SW-кеше skip'ают `loadBuffer()` (но считаются в
  `loaded/total` — audio context заберёт из кеша на first play).
  Phase 2.
- **WebMIDI permission timeout 1s** в `MidiInput.requestMidiAccess`
  (Chromium silent-dismiss hang → return null, не блокируем
  PianoKeyboard onMount). `getMidiPermissionState()` через
  `navigator.permissions.query` — reserved для будущего UI. Phase 2.
- **Piano status pill** показывает `MIDI: N devices · M нот` (M =
  active notes count, единый source-of-truth с on-screen stack). Маленький
  green dot при `M > 0`. Phase 2.
- `npm run validate:presets` (root) + `pnpm --dir ui run
  validate:presets` — boot-lint каждой `BUILTIN_PRESETS` через
  `validatePreset` (Phase 1). Pre-commit hook (`scripts/pre-commit`):
  typecheck + vitest + `lint:no-console` + validate:presets. Установка
  через `ln -s ../../scripts/pre-commit .git/hooks/pre-commit`. Phase 2.

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
