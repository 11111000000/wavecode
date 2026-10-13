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
| `wavecode-log-pipeline` | applied | 7 files (5 new log infra + 1 modified patch + packet.md) | L0 `cleanLogArgs` (идемпотентный %c-strip, 9 кейсов), L1 ring-buffer (500 entries, 8 кейсов), L2 `wrapStrudelLogger` дёргает cleanLogArgs вместо inline. Strudel logger.mjs:21 → читаемая console.error строка. |
| `wavecode-debug-console` | applied | 13 files (Toast/ConsoleButton/ConsoleSheet + consoleStore + consoleGlobals + App.tsx + components.css + console.spec.ts e2e — DELETED DebugPanel.tsx + debug.css) | Toast для critical/error, ConsoleButton (bottom-right FAB, badge + error-pulse), ConsoleSheet (tabs Errors/All/By source + copy/clear/filter). UX-контракт из чата автора 2026-10-12. |
| `wavecode-preset-decode-race` | applied | 6 files (presets.ts + SampleLoader.ts + new withConcurrency + tests) | 7 строк `n("note_name")` → `note("note_name")` (superdough nanFallback NaN-строк → silent hap), `withConcurrency(urls, 4, fn)` для preloadAllBuffers, `validatePreset(preset)` dev-lint. |
| `wavecode-piano-polyphony` | applied | 6 files (notes.ts + pianoSynth.ts + PianoKeyboard.tsx + tests + piano.spec.ts e2e) | `SILENCE_SNIPPET` + `multiNoteSnippet(notes)` + `buildPianoSnippet(activeMidi)`. Accumulator-семантика в PianoKeyboard (true polyphony через stack, не sequential `<…>`). 30 ms debounce на rapid press. |
| `wavecode-logger-enhancements` | applied | 7 files (3 new log infra: throttle.ts/idbBuffer.ts + modified logger.ts + index.ts + 3 new test files) | Phase 2 Subagent 6. `LogLevel` widens с `fatal`; pure `shouldEmit` throttle (5 emits/source/1000ms, suppress → single warn-level drop entry); `idbBuffer` dynamic-imports `idb-keyval` (last 100 errors, fire-and-forget). 26 new tests. Axiom A2 (pure throttle helper). |
| `console-ux-polish`¹ | applied | 9 files (consoleHotkey.ts + Toast.tsx + ConsoleButton.tsx + consoleGlobals.ts + consoleStore.ts + icons/index.tsx + components.css + 2 test files) | Phase 2 Subagent 7. `fatal` severity в `ToastSeverity` (та же sticky-семантика, что critical); SVG-иконки (`InfoIcon` / `WarnIcon` / `ErrorIcon` / `CriticalIcon`) — color-blind channel (WCAG 1.4.1); `Cmd/Ctrl+`` hotkey для console toggle, suppressed в INPUT/TEXTAREA/contenteditable. 8 new tests. Axiom A4. |
| `wavecode-sample-progress`² | applied | (нет пакета — Subagent 8 не создал packet) | Phase 2 Subagent 8. SW-cache pre-check (`swCache.isInServiceWorkerCache`) — `SampleLoader.preloadAllBuffers` skip-cached-but-count для закрытия audio-context decode race; `SampleProgressBadge` слушает `'wavecode:sample-progress'` CustomEvent → "Загружено N/M семплов" в TabBar. 22 new tests. |
| `wavecode-piano-midi`² | applied | (нет пакета — Subagent 9 не создал packet) | Phase 2 Subagent 9. `MidiInput.requestMidiAccess` races 1-second timeout (Chromium permission prompt hang → return null); `getMidiPermissionState` (`granted`/`denied`/`prompt`); `PianoKeyboard` показывает active-notes count + имя устройства в `.piano-midi-status` pill (single source of truth с on-screen stack). 19 new tests. |
| `wavecode-quality-tooling` | applied | 7 files (eslint.config.js + validate-presets.ts + pre-commit + package.json + ui/package.json + llmEdit.ts + packet) | Phase 2 Subagent 10. `no-console: error` ESLint override для `src/domain/**` + `src/application/**` (1 straggler console.log в `llmEdit.ts:265` removed); `scripts/validate-presets.ts` boot-lint `BUILTIN_PRESETS` (Node-strip-types, dynamic-import transpiler, `new Function()` fallback); `scripts/pre-commit` bash hook (typecheck + vitest + lint:no-console + validate:presets). Axiom A4. |

¹ `console-ux-polish` — outlier без префикса `wavecode-` (создан Subagent 7 на горячую параллельную ветку). Будет переименован в `wavecode-console-ux-polish` в follow-up commit после Phase 3; имя папки — единственный exception к конвенции `wavecode-*`.

² `wavecode-sample-progress` и `wavecode-piano-midi` — Subagent 8 и Subagent 9 не создали packet'ы в Phase 2. Записи выше — это краткое резюме решений; полные пакеты будут созданы при первой touch surface (Phase 4+).
