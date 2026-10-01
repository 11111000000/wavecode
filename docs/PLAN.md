# PLAN — wavecode

> Синтез диалектического разбора. Что есть, что строится, в каком порядке.
> Основано на пакетах в `math/`.

## 1. Резюме (thesis)

**wavecode** — браузерный SPA для live-coding музыки с AI-агентом.
Pure-frontend, реальный Strudel+Web Audio в браузере, без backend, без
интеграции с `~/Projects/Composer/`.

```
┌──────────────────────────────────────────────────────────────────────┐
│ Browser (single SPA, Solid.js)                                       │
│                                                                      │
│  ┌─────────────────────┐    ┌────────────────────────────────────┐  │
│  │ Solid.js 1.8        │    │ Main thread (Strudel runtime)       │  │
│  │ CodeMirror 6        │    │ @strudel/webaudio.evalScope         │  │
│  │ solid-js/store      │    │ superdough → Web Audio API          │  │
│  │ Effect-TS runtime   │    └─────────────┬──────────────────────┘  │
│  └──────────┬──────────┘                  │                         │
│             │                              ▼                         │
│             │                    ┌───────────────────────────────┐  │
│             │                    │ Web Audio API → speakers       │  │
│             │                    └───────────────────────────────┘  │
│             ▼                                                      │
│  ┌─────────────────────┐                                          │
│  │ LLMClient (raw fetch)│                                          │
│  │ → llm.kosov.online  │                                          │
│  └─────────────────────┘                                          │
└──────────────────────────────────────────────────────────────────────┘
```

## 2. Антитезис

**Слабые места текущего дизайна:**

| # | Риск | Митигация |
|---|---|---|
| 1 | Strudel в браузере слабее Tidal+SuperDirt | Если нужен pro-grade звук — отдельный backend, не Composer |
| 2 | Pure-frontend = single-user, нет коллабораций | Use case = local live-coding; multi-user вне scope |
| 3 | Strudel main-thread eval блокирует UI | Pattern eval <10ms; если станет узким — вынести transpile в Worker |
| 4 | Effect-TS кривая обучения +50 KB bundle | Чистая архитектура, тестируемость |
| 5 | LLM-прокси external dependency (llm.kosov.online) | LiteLLM с per-app-ключами, revocable |
| 6 | Нет SSR — пустой экран 200-500ms | Loading-state в index.html |

## 3. Синтез (что выбрали и почему)

| Решение | Thesis | Antithesis | Synthesis |
|---|---|---|---|
| **Pure frontend** | Нет infra, deploy anywhere | Нет pro audio, нет streaming | Local use case, sufficient |
| **Solid.js** | ~7 KB, fine-grained, max perf | Меньше экосистемы чем React | Частые обновления UI, своя экосистема не нужна |
| **Strudel в браузере** | Низкая латентность, no deps | Менее pro чем Tidal+SuperDirt | 80% patterns покрыто, pro = опциональный backend |
| **Effect-TS** | Типизированные эффекты, DI, testability | Bundle +50 KB, learning curve | Сложный async flow (LLM+tools+audio) |
| **CodeMirror 6** | ~200 KB, extensible | Monaco проще в setup | Vanilla API, custom mini-notation extension |
| **Raw fetch LLM** | Нет SDK bloat, прямой контроль | Нет tool calling из коробки | LiteLLM = прямой OpenAI-compatible; tool calling добавим позже если нужно |
| **IDB persistence** | Score переживает reload | +5 KB bundle | Без этого UX плохой |
| **Static SPA deploy** | Простой deploy anywhere | Нет SSR | SEO нерелевантен, loading-state OK |
| **Vitest + Playwright** | Пирамида тестов | E2e flake risk | Domain pure → быстрые unit; e2e для critical |
| **Strict layering ESLint** | Защита архитектуры | Можно обойти eslint-disable | Testability + заменяемость impl |

## 4. Roadmap

### Phase 1: Skeleton ✅
✅ `wavecode-scope` — pure-frontend
✅ `wavecode-stack-performance` — Solid.js
✅ `wavecode-strudel-in-browser` — Strudel + Web Audio
✅ `wavecode-effect-ts-architecture` — Effect-TS 4 layers
✅ `wavecode-codemirror-6` — editor
✅ `wavecode-llm-litellm-proxy` — LLM endpoint
✅ `wavecode-static-spa-deployment` — no Nix, no container
✅ `wavecode-test-strategy` — vitest + playwright
✅ `wavecode-strict-layering` — ESLint rules
✅ Configs: vite + tsconfig + eslint + playwright + index.html
✅ src/ — 4-layer skeleton
✅ npm install

### Phase 2: Agent loop ✅
✅ `domain/types.ts` — Score, Message, AppState
✅ `domain/tools/editScore.ts` — zod-schemas + applyEdit (pure)
✅ `application/reducer.ts` — pure reducer для AppState
✅ `application/useCases/llmEdit.ts` — system prompt + applyEdit orchestration
✅ `infrastructure/llm/LiveLLMClient.ts` — raw fetch + SSE/JSON parse
✅ `infrastructure/audio/LiveAudioEngine.ts` — `@strudel/webaudio` wrapper
✅ `infrastructure/repo/IDBRepo.ts` — IndexedDB persistence
✅ `presentation/panels/AIEditPanel.tsx` — Solid chat
✅ `presentation/components/CodeMirrorEditor.tsx` — vanilla CM6 mount

### Phase 3: Polish ✅
✅ IDBRepo: autosave score + reload
✅ CodeMirror mini-notation highlight + completions
✅ E2E тест: edit score → eval → audio plays
✅ Cleanup: dead code, dead deps, inline styles → CSS

### Phase 2.5 / 3.5: Presets + LLM UI Settings ✅ (added 2026-10-01)
✅ `domain/presets.ts` — 8 встроенных пресетов: Creep (Radiohead),
   Seven Nation Army (White Stripes), Für Elise (Beethoven),
   Smoke on the Water (Deep Purple), House of the Rising Sun,
   Let It Be / Wonderwall-style progressions, Mary Had a Little Lamb
✅ `presentation/state/presetsStore.ts` — custom-пресеты в localStorage
   (`wavecode-custom-presets-v1`), save/delete/reset-all
✅ `presentation/state/audioActions.ts` — извлечённые evalScore/stopAudio/beep
   (раньше copy-paste между панелями)
✅ `presentation/state/llmSettings.ts` — model (smart|fast) + thinking
   (low|high|off), UI-state в localStorage (`wavecode-llm-settings-v1`)
✅ App.tsx: header restructured — preset selector, save/delete/reset
   buttons, Eval/Stop/test-beep buttons, live ctx state polling
✅ App.tsx: createEffect autosave (500ms debounce) + onMount loadScore
✅ LiveAudioEngine: unlockAudioContext + getDebug + createOscillator
   trigger counter для мобильной отладки
✅ LiveLLMClient: `req.thinking` → LiteLLM `reasoning_effort`
✅ cleanLLMResponse rewrite: fallback на raw при пустом ответе,
   извлечение pattern-кода из prose
✅ Unit-тесты: +23 (39 всего) — domain/presets, presetsStore, llmSettings
✅ E2E тесты: +3 specs — presets, persistence, strudel-debug
✅ math/wavecode-presets/packet.md — пакет решения
✅ ui/ARCHITECTURE.md — секции 3.3, 3.4, 10

### Phase 4: Future
🔲 RAG по Strudel-функциям (если нужно)
🔲 Tool calling через @ai-sdk (вместо whole-score replacement)
🔲 Concurrent edits (lock или last-write-wins)
🔲 Theme switcher (dark/light)
🔲 Hot-reload через HMR для Score updates

## 5. Архитектурные инварианты

Эти правила не меняются без явного решения в новом пакете:

1. **Domain = pure.** Никаких эффектов, никаких импортов извне.
2. **Infrastructure = effects.** Всё IO через Layer.
3. **Presentation не знает про audio/AI/DB.** Только через сервисы.
4. **Effect-TS — для всех асинхронных операций.** Никакого raw fetch/eval в components.
5. **Score = JS-файл со Strudel mini-notation.** Не Haskell, не YAML.
6. **Деплой = `npm run build` → `dist/`.** Никаких Nix-выходов.
7. **LLM через llm.kosov.online.** Per-app Bearer-ключ.

## 6. Открытые вопросы (для будущих пакетов)

| Вопрос | Когда решать |
|---|---|
| RAG по Strudel: нужен или нет? | Phase 4, после eval первых 20+ функций |
| Tool calling: добавить или оставить whole-score replacement? | Phase 4, если качество LLM-edit упадёт |
| Concurrent edits: lock или CRDT? | Phase 4, если планируется multi-tab |
| Theme: какие цвета/типографика? | Phase 4, перед релизом |

## 7. Что НЕ входит

- ❌ Backend-сервис любого рода
- ❌ Интеграция с `~/Projects/Composer/`
- ❌ SSR (Next.js / SolidStart)
- ❌ База данных (кроме IndexedDB)
- ❌ Multi-user / коллаборация
- ❌ Публичный стрим / Icecast
- ❌ Nix-флейк outputs
- ❌ Docker / контейнеры

## 8. Branch status (на 2026-10-01)

| Ветка | Коммитов после master | Что |
|---|---|---|
| `master` | 0 | regex-bypass аудио (mini-notation не работает), LLM polish, REPL-only UI |
| `refactor-wavecode-restore-strudel` | +11 | real Strudel runtime + 8 пресетов + persistence + LLM UI settings + 23 unit + 3 e2e |

Мердж `refactor-wavecode-restore-strudel` → `master` — отдельная задача.
Перед мержем проверить, что `domain/types.ts:initialAppState.score` (полный
Creep) играет через `webaudioRepl` без ошибок на мобильном — это риск.
