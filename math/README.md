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
| `wavecode-llm-cors-explicit-allowlist` | applied | 3 files (cross-repo) | Explicit finite allowlist в `services.llm-proxy.publicInstance.corsAllowedOrigins`; wavecode добавлен в список. Попутно убран дубль `console.log` в `LiveLLMClient.ts`. |
| `wavecode-llm-revert-basicauth` | applied | 2 files AngaraConfig | Tier llm vhost public-auth → public: basic-auth gate ловил всех bearer-only клиентов (Genium Lab, Geopulse, wavecode) с 401 с 2026-10-07. CORS + per-app keys — единственная защита. Side-effect: пофикшен kinetic brace bug от Paseo tree-stend коммита. |
| `wavecode-static-spa-deployment` | applied | none | Деплой как статический SPA, без Nix/Docker |
| `wavecode-test-strategy` | applied | none | vitest + playwright (пирамида) |
| `wavecode-strict-layering` | applied | none | ESLint no-restricted-imports per-layer |
| `wavecode-redesign-repl-phosphor` | retired | superseded | REPL Phosphor (амбер-only, sharp, mono) — superseded by modern-mobile-redesign |
| `wavecode-modern-mobile-redesign` | applied | 19 files (5 CSS-слоёв + 8 компонентов + App.tsx + index.html + manifest + test) | Synthwave Modern Terminal: палитра spectrum (amber+cyan+magenta) на amoled-black, mobile-first с BottomSheet (snap-points) + TabBar + FAB, Geist Sans+Mono, 8 новых компонентов, soft corners 8-12px, touch-таргеты ≥44px. Задеплоено на prod. |
| `wavecode-sample-pack` | applied | piano pack | Salamander Grand Piano v3 (CC0, 10 MP3) + PianoSampleLoader + 2 demo presets. Синт-808 как bonus через pure Strudel synthesis. |
| `wavecode-sample-synth` | applied | synth pack | 12 CC0 analog-synth MP3 (4 bass + 4 pad + 2 lead + 1 strings + 1 brass, 1.3MB), Freesound preview CDN. SampleLoader.ts unified aggregator (piano + drums + synth). 3 demo presets. |
