# wavecode-multi-undo — implementation notes

Дополнение к `packet.md` для читателя, который уже знаком с
proposition/antithesis/synthesis и хочет понять «как именно это
сделано в коде». Не нормативный пакет; правки сюда не требуют
peer-review, но существенные расхождения с реализацией стоит
backport-нуть в `packet.md`.

## Где живёт undo/redo state

- `ui/src/domain/types.ts:46-47` — поля `history`/`future` на
  `AppState`, плюс `HISTORY_LIMIT = 50` (`types.ts:57`).
- `ui/src/application/reducer.ts:10-27` — `AppEvent` union
  включает `undoScore` / `redoScore` / `commitHistoryCheckpoint`;
  case-ветки — `reducer.ts:88-117`.
- `ui/src/presentation/state/appStore.ts` — Solid `createStore`
  + `dispatch` обёртка; `dispatch` это единственный public API для
  мутации state (мутации идут через pure `reduceAppEvent` внутри
  `produce()`).

Pure-fn reducer pattern — все undo/redo ветки возвращают новый
`AppState` через spread. Никаких мутаций in-place; это
позволяет тривиально тестировать reducer в изоляции от Solid
runtime (см. `reducer.test.ts`).

## Keyboard wiring

`installKeyboardShortcuts` в `ui/src/presentation/state/uiState.ts:314-357`
принимает `{focusAI, focusScore, undoScore, redoScore}` refs от
`App.tsx:69-86` и навешивает глобальный `keydown` handler на
`window`. Multi-undo keys:

- `Ctrl+Z` (без Shift) → `undoScore()`
- `Ctrl+Y` (без Shift) → `redoScore()` (Linux/Windows convention)
- `Ctrl+Shift+Z` → `redoScore()` (macOS convention)
- `Ctrl+Meta+Z` (macOS Cmd+Z) → `undoScore()` (через общий
  `e.ctrlKey || e.metaKey` check)

Когда фокус в `HTMLInputElement` (кроме checkbox/radio) или
`HTMLTextAreaElement`, handler **пропускает undo/redo** чтобы
native text-undo работал корректно при typing в AI textarea
(`uiState.ts:326-329`).

`App.tsx:84-85` перед `dispatch({type: 'undoScore'})` вызывает
`stopAudio()` чтобы предотвратить хвост от старого score при
переключении; эта обёртка специально НЕ в reducer (это side
effect), и в unit-тестах мы тестируем только сам reducer
(stopAudio мокается в integration tests для `App.tsx`).

## Typing debounce (600ms)

`ui/src/presentation/state/editorTypingTracker.ts:25-53` —
`installTypingTracker(dispatch)` устанавливает Solid
`createEffect` на `appStore.score` (внутри `createRoot` для
disposal). На каждое изменение `score` сбрасывается 600ms
`setTimeout`; по истечении диспатчится
`commitHistoryCheckpoint` который "схлопывает" верхнюю запись
`history` с предыдущей (reducer.ts:112-117 — `history.slice(0, -1)`
когда `history.length >= 2`).

Семантика collapse:

- юзер печатает "abcd" одним непрерывным потоком → 4 записи в
  history, после 600ms паузы все схлопываются в одну →
  undo возвращает сразу к "до начала правки";
- юзер печатает "abc", пауза 600ms, потом "def" → после первой
  паузы collapse, "def" — отдельная запись → undo #1 откатывает
  "def", undo #2 откатывает "abc".

`commitHistoryCheckpoint` no-op когда `history.length < 2`
(`reducer.ts:113`) — guard от случайной dispatch когда
history пуст (например, сразу после boot).

## Push-cap helper

`reducer.ts:42-46` — `pushCapped<T>(arr, item, limit)`. Использует
`slice(next.length - limit)` если length > limit. Slice, не
shift-in-place, чтобы reducer остался pure. Применяется
одинаково к `history` и `future` — обе стека capped в 50.

## IDB persistence trade-off

Только current `score` сохраняется через
`infrastructure/repo/IDBRepo.ts` (autosave debounce 500ms в
`useAutoSave.ts`). `history`/`future` — in-memory, **не
персистентные**. После reload юзер получает чистый `history: []`
и не может undo'ить за прошлую сессию.

Это **deliberate trade-off** (per packet substrate):

- + 50 стеков × 10KB score = 500KB на IDB-write, причём
  без выигрыша для большинства юзеров (они undo'ят сейчас, а не
  через час);
- + упрощает `IDBRepo` schema migration (не нужно версионировать
  историю при изменении `AppState`);
- + юзер всё ещё может undo'нуть через Cmd+Z в браузере если
  page не перегружен.

## Тесты

| Файл | Тестов | Покрытие |
|---|---|---|
| `ui/src/application/reducer.test.ts` | 32 (13 multi-undo) | reducer purity, undo/redo symmetry, history cap, future-clear, idempotent replace, commitHistoryCheckpoint merge + no-op |
| `ui/src/presentation/state/editorTypingTracker.test.ts` | 2 | debounce grouping с коротким 30ms debounce (600ms тяжело для <5s test budget) + 600ms constant assertion |
| `ui/src/presentation/state/uiState.test.ts` | 30 (8 multi-undo keyboard) | mobile mode, layout, bottom sheet, keyboard shortcuts (Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z, focus-skip в INPUT/TEXTAREA, Meta+Z = Cmd+Z) |

## Известные ограничения

1. **Ctrl+Z в CodeMirror** — глобальный keydown handler в
   `uiState.ts` ставит `e.preventDefault()` только когда фокус
   НЕ в text-input. CodeMirror's `.cm-content` — `contenteditable`
   div, не input; в нём `Ctrl+Z` корректно проксируется на
   CodeMirror history (отдельный от нашего). Это и хочется: code
   editor имеет свой undo stack, юзер не ожидает что один Ctrl+Z
   отменит typing в score editor (наш `replaceScore` + 600ms
   debounce + `commitHistoryCheckpoint` как раз и даёт ту же
   "burst = one undo" семантику).
2. **`commitHistoryCheckpoint` срабатывает на каждом
   `appStore.score` change** — включая undo/redo и preset load.
   Для programmatic changes (undo/redo) это no-op (history уже
   collapsed после 600ms паузы). Для preset load — score меняется
   один раз, debounce ждёт 600ms и потом collapses; если юзер
   сразу нажмёт undo, history уже содержит old score из
   `replaceScore` push, и undo корректно откатывает к предыдущему
   preset. Без race.
3. **50 entries = ~500KB** — на мобильных с 256MB RAM
   (старые iPhone) это теоретический потолок. На практике
   10KB score = максимум 50 длинных пресетов с большим code
   stack; рядовой юзер не достигнет cap. Если cap станет
   реальной проблемой — `HISTORY_LIMIT` constant легко
   параметризовать.
