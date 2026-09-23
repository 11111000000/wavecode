# Composer UI — Architecture

> **Note**: несмотря на имя файла (`Composer UI`), это архитектура **wavecode**.
> Composer — отдельный backend-проект, wavecode его не знает.

Браузерный SPA для live-coding музыки с AI-агентом. Pure-frontend: ни
серверного процесса, ни интеграции с `~/Projects/Composer/`.

> **Зачем этот документ.** Любая правка `ui/` обязана согласовываться с
> описанной ниже моделью. Если задача требует правило нарушить —
> сначала правило обновляется здесь, потом код.

---

## 0. Принципы

1. **Domain — чистые данные и функции.** Никаких `fetch`, `AudioContext`,
   `document`, `solid-js`, никаких побочных эффектов.
2. **Эффекты — на границе, описаны как данные.** Все внешние вызовы (LLM,
   Strudel eval, IndexedDB) — типизированные `Effect` из Effect-TS.
3. **Зависимости инжектятся через `Layer`.** Никаких глобальных синглтонов,
   никакого `import { strudel } from "./audio"`.
4. **Инструменты агента — декларативные схемы.** Агент не вызывает функции
   напрямую; он возвращает план вызова, runtime исполняет.
5. **UI-state отдельно от domain-state.** `solid-js/store` хранит только то,
   что связано с экраном. Бизнес-state проходит через reducer в `application/`.
6. **Тесты пишутся против domain/application** (без DOM, без LLM, без Web Audio).
   `infrastructure` тестируется с моками Layer.

---

## 1. Слои

```
┌────────────────────────────────────────────────────────┐
│ presentation/   Solid-компоненты, темы, роутинг          │
│                 импорт: domain, application (через DI)  │
├────────────────────────────────────────────────────────┤
│ application/    use-cases: agentStep, editScore,        │
│                 evalPattern. Pure функции поверх       │
│                 domain + Effect.                        │
│                 импорт: domain, effect, infrastructure  │
│                 (только как типы Layer)                  │
├────────────────────────────────────────────────────────┤
│ infrastructure/ Реализация эффектов: llmClient,         │
│                 audioEngine, repo, clock.               │
│                 импорт: effect, @effect/platform-browser│
├────────────────────────────────────────────────────────┤
│ domain/         Типы: Score, Message, Tool, AgentState. │
│                 Чистые функции: applyEdit, parseTool,   │
│                 validateSnippet, miniNotationKeywords.  │
│                 импорт: ничего, кроме effect (Schema)   │
└────────────────────────────────────────────────────────┘
```

### 1.1. `domain/`

Содержит:
- **Типы**: `Score`, `Snippet`, `Message`, `Role`, `Tool`, `ToolCall`,
  `ToolResult`, `AgentState`, `AgentEvent`.
- **Схемы**: `@effect/schema` для типов, отдаваемых наружу (валидация
  ответов LLM, валидация JSON-сообщений).
- **Чистые функции**: `applyEdit(score, edit): Score`,
  `parseToolCall(json)`, `validateSnippet(jsStr): Result<Snippet, Error>`,
  `miniNotationTokens(str): Token[]`.
- **Константы**: список Strudel-функций для автокомплита, словарь
  mini-notation.

Запрещено:
- `import "solid-js"`
- `import "@strudel/*"` (только типы из effect)
- `import "tone"`
- любой `fetch`, `AudioContext`, `localStorage`, `indexedDB`

### 1.2. `application/`

Use-cases — `Effect`-функции, описывающие что должно произойти, но не как:

```ts
// application/agentLoop.ts
export const agentStep = (
  state: AgentState,
  event: AgentEvent,
): Effect<AgentState, AgentError, AgentEnv> => ...

// application/editScore.ts
export const editScore = (
  score: Score,
  edit: ScoreEdit,
): Effect<Score, never, never> => ...   // pure

// application/evalSnippet.ts
export const evalSnippet = (
  snippet: Snippet,
): Effect<void, AudioError, AudioEnv> => ...
```

Зависимости (`AgentEnv`, `AudioEnv`) — `Layer`-описания сервисов
(`LLMClient`, `AudioEngine`, `Repo`), реализации — в `infrastructure`.

### 1.3. `infrastructure/`

Реализует сервисы:

| Сервис | Реализация | Файл |
|---|---|---|
| `LLMClient` | `@ai-sdk/openai-compatible` → `llm.kosov.online/v1` | `infrastructure/llm/LiveLLMClient.ts` |
| `AudioEngine` | `@strudel/core` + `@strudel/webaudio` в Web Worker | `infrastructure/audio/StrudelEngine.ts` |
| `ToneGraph` | `tone` для эффектов (reverb/delay/filter) | `infrastructure/audio/ToneGraph.ts` |
| `Repo` | IndexedDB (`idb-keyval`) | `infrastructure/repo/IDBRepo.ts` |
| `Clock` | `Effect Clock` | `infrastructure/clock/ClockLive.ts` |

Каждый экспортирует `Layer.succeed(Service, impl)` или `Layer.effect(...)`.

**Web Worker для Strudel**: Strudel eval не должен блокировать UI и LLM-stream.
Worker создаётся через `new Worker(new URL('./strudel.worker.ts', import.meta.url), { type: 'module' })`.
RPC-протокол — JSON-сообщения через `postMessage`.

### 1.4. `presentation/`

Solid-компоненты (JSX из `solid-js`). Получают данные через `solid-js/store`
(`createStore`) для UI-state или через сигналы от `application/`.

```tsx
// presentation/panels/ChatPanel.tsx
import { createSignal, Show } from 'solid-js';
import { uiStore } from '../state/uiStore';
import { submitMessage } from '../../application/actions';

export function ChatPanel() {
  const [text, setText] = createSignal('');
  const onSubmit = (e: SubmitEvent) => {
    e.preventDefault();
    submitMessage(text());
    setText('');
  };
  return (
    <Show when={uiStore.chatOpen}>
      <form onSubmit={onSubmit}>
        <input value={text()} onInput={e => setText(e.currentTarget.value)} />
      </form>
    </Show>
  );
}
```

Запрещено:
- вызывать `fetch` или `@ai-sdk/*` напрямую
- импортировать `@strudel/*` или `tone`
- держать бизнес-state в `createSignal` (только UI-state, бизнес-state в `solid-js/store`)

---

## 2. Внешние границы

```
                    ┌────────────────────┐
   browser SPA ────►│ presentation/      │
                    └──────────┬─────────┘
                               │ dispatch(action)
                    ┌──────────▼─────────┐
                    │ application/       │   ← чистая оркестровка
                    │ (reducer + effects)│
                    └──────────┬─────────┘
                               │ Effect.gen
              ┌────────────────┼─────────────────┐
              ▼                ▼                  ▼
       ┌─────────────┐  ┌──────────────┐  ┌──────────────┐
       │ LLMClient   │  │ AudioEngine  │  │ Repo         │
       │ MiniMax via │  │ Strudel+     │  │ IndexedDB    │
       │ llm.kosov   │  │ Tone.js      │  │              │
       └─────────────┘  └──────────────┘  └──────────────┘
              │                │
              ▼                ▼
       llm.kosov.online  Web Audio → speakers
       (внешний LLM)     (колонки)
```

### 2.1. LLM-клиент

`baseURL` — `https://llm.kosov.online/v1` (LiteLLM proxy, OpenAI-compatible).
`apiKey` — из `VITE_LLM_PROXY_KEY` (per-app `sk-litellm-...` ключ).
Модели по умолчанию:
- `smart` — для правки кода (temperature=0.2, topP=0.9)
- `fast` — для чата/REPL (temperature=0.7)

Конфиг в `infrastructure/llm/config.ts` — единая точка изменения.

### 2.2. AudioEngine (Strudel + Tone.js)

```
┌──────────────────┐
│ Strudel runtime  │  Web Worker (eval, scheduler)
│ @strudel/core    │
│ @strudel/webaudio│
└────────┬─────────┘
         │ pattern events (gain, freq, time)
         ▼
┌──────────────────┐
│ Tone.js effects  │  Main thread (reverb, delay, filter)
│ tone.Reverb      │
│ tone.FeedbackDelay│
└────────┬─────────┘
         ▼
   Web Audio API → speakers
```

**Почему Worker**: Strudel scheduler и eval не блокируют UI и LLM-stream.
**Почему Tone.js в main thread**: AudioContext живёт в main thread (ограничение
Web Audio API в браузерах), Tone.js управляет эффектами через него.

### 2.3. Persistence

`Repo` хранит:
- последний `Score` (autosave раз в 5 сек после edit)
- последние N сообщений чата (по умолчанию 200)
- настройки UI (theme, layout)

Хранилище — IndexedDB через `idb-keyval`.

---

## 3. Agent loop

```
   user message
        │
        ▼
   AgentState.transition(UserMessage event)
        │
        ├──► appendToMessages
        ├──► if state.toolCallInFlight: queue
        └──► schedule next step (Effect.fork):
                │
                ▼
       llmClient.streamCompletion({
         model: 'smart',
         tools: [readScore, editScore, replaceScore,
                 evalSnippet, undoScore, askUser],
         messages: state.messages + systemPrompt
       })
                │
                ├── onTextChunk → appendToMessages
                └── onToolCall → executeTool → appendToMessages → next step
```

### 3.1. Tool-calling

Tools объявлены **один раз** в `domain/tools/*.ts` как zod-схемы:

```ts
// domain/tools/editScore.ts
export const editScoreTool = {
  name: 'edit_score',
  description: 'Точечная правка блока в score. Укажи oldText — он будет заменён на newText.',
  input: z.object({
    oldText: z.string().min(1),
    newText: z.string(),
  }),
  execute: (input, env) =>
    Effect.gen(function* () {
      const score = yield* env.repo.loadScore();
      const next  = applyEdit(score, input);
      yield* env.repo.saveScore(next);
      yield* env.audio.eval(snippetFromScore(next));
      return { ok: true, preview: snippetFromScore(next) };
    }),
};
```

`application/agentLoop.ts` подключает их и передаёт в `streamCompletion`.

### 3.2. Инструменты (v1)

| Tool | Назначение |
|---|---|
| `read_score` | Вернуть текущий score (для контекста) |
| `edit_score` | Точечная правка с old/new (атомарно) |
| `replace_score` | Полная замена (для крупных изменений) |
| `eval_snippet` | Выполнить snippet в Strudel runtime, вернуть stderr/eval-errors |
| `undo_score` | Откатиться к предыдущей версии |
| `ask_user` | Задать уточняющий вопрос |

Расширение — добавить файл в `domain/tools/`, без правок агента.

---

## 4. Editor (CodeMirror 6)

База: `@codemirror/lang-javascript` через `StreamLanguage`.
Поверх — extension'ы:

1. **`miniNotationDecorations`**: regex-highlight на Strudel mini-notation
   (`<bd sd hh>`, `[bd sd]`, `*`, `~`, `:` и т.д.) — собственная реализация
   через `StateField` + `Decoration`.
2. **`strudelCompletions`**: статический список из `domain/strudel/keywords.ts`
   (`s`, `every`, `jux`, `rev`, `fast`, `slow`, `stack`, `cat`, `chop`,
   `sometimes`, `mask`, ...), подключённый через `CompletionSource`.

Lint: `@codemirror/lint` с диагностиками из `application/lint/*`.

---

## 5. State

### 5.1. UI-state (solid-js/store)

```ts
// presentation/state/uiStore.ts
import { createStore } from 'solid-js/store';

type UIState = {
  leftPanelOpen: boolean;
  rightPanelOpen: boolean;
  theme: 'dark' | 'light';
  chatOpen: boolean;
};

export const uiStore = createStore<UIState>({
  leftPanelOpen: true,
  rightPanelOpen: true,
  theme: 'dark',
  chatOpen: true,
});
```

### 5.2. Domain-state (solid-js/store + reducer)

Хранится в `solid-js/store`, **но** reducer — pure-функция в `application/reducer.ts`,
а store используется только как контейнер.

```ts
// presentation/state/appStore.ts
import { createStore } from 'solid-js/store';
import type { AppState } from '../../domain/types';

export const [appStore, setAppStore] = createStore<AppState>({
  score: { snippets: [], cursor: 0 },
  messages: [],
  agent: { status: 'idle' },
  audio: { status: 'stopped' },
});

// Все мутации — через reducer (pure fn):
// setAppStore(produce(s => reduceAgentEvent(s, event)));
```

Преимущество: тестировать reducer можно без Solid и без store.

---

## 6. Тестирование

| Слой | Что тестируем | Чем |
|---|---|---|
| `domain/` | чистые функции: parse, validate, schema | `vitest` (никаких моков) |
| `application/` | reducer + use-cases | `vitest` + `TestClock`, mock Layer |
| `infrastructure/` | формат запроса/ответа | `vitest` + `Layer.succeed` моки |
| `presentation/` | рендер, взаимодействие | `@solidjs/testing-library` |
| e2e | полный flow: напечатал → LLM ответил → eval → звук | `@playwright/test` |

Цель — 80%+ покрытие `domain` и `application`.

---

## 7. Запреты (lint-enforced)

Через `eslint-plugin-import` + `no-restricted-paths`:

```js
// eslint.config.js (черновик)
'import/no-restricted-paths': ['error', {
  zones: [
    { target: './src/domain', from: './src/infrastructure', message: 'domain не должен знать про infrastructure' },
    { target: './src/domain', from: './src/application',   message: 'domain не должен знать про application' },
    { target: './src/domain', from: './src/presentation',  message: 'domain не должен знать про presentation' },
    { target: './src/application', from: './src/presentation', message: 'application не должен знать про presentation' },
  ],
}],
```

Плюс `no-restricted-imports`:
- `domain/**` не может импортить `solid-js`, `@effect/platform-browser`,
  `idb-keyval`, `@strudel/*`, `tone`, `@ai-sdk/*`.
- `infrastructure/**` не может импортить `solid-js`.
- `presentation/**` не может импортить `@strudel/*`, `tone`, `@ai-sdk/*`.

---

## 8. Что НЕ входит в этот документ

- Dev-loop (Vite config, тест-сетап) — отдельный `docs/dev.md`.
- Дизайн-система (точные цвета/темы) — `docs/design.md`.

## 9. Открытые вопросы

1. **RAG по Strudel-функциям.** Сейчас — статический JSON из ~200 функций.
   Если окажется мало — локальные embeddings + vector store.
2. **Streaming UX.** Модель стримит текст порциями; показывать сырой стрим
   или буферизовать до конца?
3. **Конфликты правок.** Если агент и пользователь редактируют score
   одновременно — стратегия (OT, last-write-wins, lock).
4. **Multi-user.** Пока single-user. Если multi — CRDT (Yjs) поверх CodeMirror.