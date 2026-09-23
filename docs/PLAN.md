# PLAN — wavecode

> Синтез диалектического разбора. Что есть, что строится, в каком порядке.
> Основано на пакетах в `math/`.

## 1. Резюме (thesis)

**wavecode** — браузерный SPA для live-coding музыки с AI-агентом.
Pure-frontend, чистый Strudel+Web Audio в браузере, без backend, без
интеграции с `~/Projects/Composer/`.

```
┌──────────────────────────────────────────────────────────────────────┐
│ Browser (single SPA, Solid.js)                                       │
│                                                                      │
│  ┌─────────────────────┐    ┌────────────────────────────────────┐  │
│  │ React... Solid      │    │ Web Worker (Strudel runtime)       │  │
│  │ CodeMirror 6        │    │ @strudel/core + @strudel/webaudio  │  │
│  │ Solid.js 1.8        │    └─────────────┬──────────────────────┘  │
│  │ Effect-TS runtime   │                  │                         │
│  └──────────┬──────────┘                  │ pattern events         │
│             │                              ▼                         │
│             │             ┌────────────────────────────────────┐    │
│             │             │ Tone.js (effects chain)            │    │
│             │             │ reverb / delay / filter            │    │
│             │             └─────────────┬──────────────────────┘    │
│             │                           │                            │
│             ▼                           ▼                            │
│  ┌─────────────────────┐    ┌────────────────────────────────────┐  │
│  │ LLMClient (AI SDK)  │    │ Web Audio API → speakers            │  │
│  │ → llm.kosov.online  │    └────────────────────────────────────┘  │
│  └─────────────────────┘                                             │
└──────────────────────────────────────────────────────────────────────┘
```

## 2. Антитезис

**Слабые места текущего дизайна:**

| # | Риск | Митигация |
|---|---|---|
| 1 | Strudel в браузере слабее Tidal+SuperDirt | Если нужен pro-grade звук — отдельный backend, не Composer |
| 2 | Pure-frontend = single-user, нет коллабораций | Use case = local live-coding; multi-user вне scope |
| 3 | Score в IndexedDB = потеряется если браузер очистить | Export/import score через UI (TODO) |
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
| **LLM через LiteLLM proxy** | Per-app-ключи, OpenAI-compatible | +latency через proxy | Уже настроено, безопаснее direct API |
| **Static SPA deploy** | Простой deploy anywhere | Нет SSR | SEO нерелевантен, loading-state OK |
| **Vitest + Playwright** | Пирамида тестов | E2e flake risk | Domain pure → быстрые unit; e2e для critical |
| **Strict layering ESLint** | Защита архитектуры | Можно обойти eslint-disable | Testability + заменяемость impl |

## 4. Roadmap

### Phase 1: Skeleton (сейчас)
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
🔲 **TODO**: src/ — 4-layer skeleton + hello-world
🔲 **TODO**: npm install (фикс dep version conflict)

### Phase 2: Agent loop
🔲 `domain/types.ts` — Score, Message, Tool, AgentState
🔲 `domain/tools/*.ts` — zod-схемы инструментов
🔲 `application/reducer.ts` — pure reducer для AppState
🔲 `application/agentLoop.ts` — orchestration через Effect.gen
🔲 `infrastructure/llm/LiveLLMClient.ts` — AI SDK integration
🔲 `infrastructure/audio/StrudelEngine.ts` — Worker RPC
🔲 `presentation/panels/ChatPanel.tsx` — Solid chat
🔲 `presentation/components/CodeMirrorEditor.tsx` — vanilla CM6 mount
🔲 Unit-тесты: domain (10-20), application (5-10)

### Phase 3: Effects + Audio
🔲 `infrastructure/audio/ToneGraph.ts` — reverb/delay chain
🔲 `infrastructure/repo/IDBRepo.ts` — persistence
🔲 Strudel mini-notation overlay для CM6
🔲 E2E тест: edit score → eval → audio plays

### Phase 4: Polish
🔲 RAG по Strudel-функциям (если нужно)
🔲 Streaming UX (chunk display)
🔲 Concurrent edits (lock или last-write-wins)
🔲 Export/import score
🔲 Theme switcher (dark/light)
🔲 Hot-reload через HMR для Score updates

## 5. Архитектурные инварианты

Эти правила не меняются без явного решения в новом пакете:

1. **Domain = pure.** Никаких эффектов, никаких импортов извне.
2. **Infrastructure = effects.** Всё IO через Layer.
3. **Presentation не знает про audio/AI/DB.** Только через сервисы.
4. **Effect-TS — для всех асинхронных операций.** Никакого raw fetch/eval в components.
5. **Score = JS-файл с Strudel mini-notation.** Не Haskell, не YAML.
6. **Деплой = `pnpm build` → `dist/`.** Никаких Nix-выходов.
7. **LLM через llm.kosov.online.** Per-app Bearer-ключ.

## 6. Открытые вопросы (для будущих пакетов)

| Вопрос | Когда решать |
|---|---|
| RAG по Strudel: нужен или нет? | Phase 4, после eval первых 20+ функций |
| Streaming UX: raw или buffer? | Phase 2, при имплементации agentLoop |
| Concurrent edits: lock или CRDT? | Phase 4, если планируется multi-tab |
| Export/import score: формат? | Phase 3, при persistence |
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