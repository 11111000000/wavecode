---
proposition: |
  `appStore.scorePrev: string` (одношаговый rollback из пакета
  `rollback-and-retry`) retire и заменяется стеком `history: string[]`
  (max 50) + `future: string[]` (max 50) — классический двусторонний
  undo/redo. В шапке вместо `↶ Откатить` — две кнопки `↶ Undo` (или
  иконка), `↷ Redo`. Keyboard shortcuts: `Ctrl+Z` undo, `Ctrl+Y` /
  `Ctrl+Shift+Z` redo. `replaceScore` сначала сохраняет старый score в
  history и clear future (как сейчас `scorePrev`), undo/redo
  переставляют score в history/future и сразу `audio.eval(score)`.
  При typing в editor дебаунс 600ms группирует соседние правки в одну
  запись history (чтобы typing в «abcd» одним undo, не четырьмя).
antithesis: |
  (1) Multi-step undo даёт «paradox на каждом character press»: один
    символ = одна запись в history, undo отменяет одну букву, юзер
    жмёт N раз. Решение: grouping внутри batch (600ms debounce или
    final commit при stop typing 600ms). (2) 50 стеков × 10KB score =
    500KB — IDB-снимок сохраняется целиком. Решение: IDB сохраняет
    ТОЛЬКО текущий `score` (как сейчас), history держим in-memory в
    appStore без persist. (3) Сценарий «юзер нажал Undo, потом что-то
    напечатал — будущее стёрто, как в macOS finder» — это и есть
    ожидаемое поведение, нужно явно задокументировать. (4) Backward
    compat: `scorePrev` уже persist через `replaceScore` save
    pattern — миграция существующих юзеров тривиальна (drop поле,
    history пуст при load). (5) `rollback-and-retry` пакет уже
    applied (sha 25e83e0) — retiring packet выглядит как «мы ошиблись».
    Скорее — supersede-with (refinement): новый пакет
    `wavecode-multi-undo` retire'ит `rollback-and-retry`.
synthesis: |
  Двусторонний stack-based undo/redo — стандарт в Figma, VSCode,
  Photoshop. Группировка по debounce. Persistence только current
  score, history — volatile. `scorePrev` retire'd через
  supersession связь в новом пакете. Keyboard shortcuts стандартны
  для desktop; mobile — через long-press на Undo кнопке не нужно
  (нет Ctrl на iPhone), возможно добавить undo-button-tap-streak
  но это overhead — кнопка `↶` крупная, tap = undo, hold = redo
  (alternative: двойная кнопка ↶↷).
substrate: |
  + `domain/types.ts`: `AppState.scorePrev` retire (поле deprecated,
    переименовано/удалено в новой версии); новые `history: string[]`
    (max 50), `future: string[]` (max 50). Initial `history: []`,
    `future: []`.
  + `application/reducer.ts`:
    - `replaceScore`: `if (state.score !== event.text) { history.push(state.score);
      history.splice(50); future = []; score = event.text; }` —
      idempotent, не дублирует в history при identical write.
    - новые `AppEvent.undoScore` / `redoScore`: pop/rotate между
      history/future/score.
    - `AppEvent.commitHistoryCheckpoint` — explicit checkpoint
      (вызывается из typing-debounce timer), не push'ит ещё одну
      запись, а merges с текущей top-of-stack.
  + `presentation/state/uiState.ts`: install keyboard shortcuts — расширен
    текущий `installKeyboardShortcuts` на `{undo, redo}` refs; `Ctrl+Z` →
    `undo`, `Ctrl+Y`/`Ctrl+Shift+Z` → `redo`.
  + `presentation/state/editorTypingTracker.ts` (new): debounce 600ms
    timer, на stop-start = `commitHistoryCheckpoint` event + reset.
    Track via `createEffect` на `appStore.score` (read before
    `replaceScore` mutates).
  + `App.tsx`: заменить `↶ Откатить` на `↶ Undo` + `↷ Redo`,
    `disabled` по `history.length === 0` / `future.length === 0`.
    `installKeyboardShortcuts` расширен refs.
  + `infrastructure/repo/IDBRepo.ts`: ключ `score` остаётся,
    persistence истории НЕ добавляется; при load history/future
    пусты (acceptable trade-off, юзер не ждёт undo за yesterday).
  − `application/reducer.ts:case 'rollbackScore'` retire; `domain/types.ts:
    AppState.scorePrev` removed в v4; миграция тривиальна.
  − `ui/src/application/reducer.test.ts`: rollback-score cases →
    undo/redo cases (rename).
status: applied
axiom: A1
witness:
  applied_at: 2026-10-08
  commit: 3ed8c73
epistemics:
  - statement: "Stack-based undo/redo — стандарт в дизайн-инструментах
      (Figma: 100 шагов; VSCode: infinite пока RAM есть)"
    marker: fact
    evidence: "Figma help «undo» = `Ctrl+Z`, до 100 шагов in memory;
      VSCode editor undoHistory = `editor.action.goToSymbol`;"
  - statement: "Типовая группировка undo по 'continuous typing session'
      — заканчивается когда пользователь не набирает 500-1500ms"
    marker: judgment
    evidence: "macOS NSUndoManager `groupsByEvent` — 800ms default
      merge; iWork/Pages — 1.5s; web IDE Monaco — 1000ms"
  - statement: "`history.length === 0 → disabled` корректно отражает
      'no more undo available'; то же для future"
    marker: fact
    evidence: "any UI toolkit convention — disabled показывает
      capability, не action availability"
  - statement: "IDB persistence `score` уже debounced 500ms в App.tsx:80-92;
      добавление persistence истории = дублирование storage logic"
    marker: fact
    evidence: "App.tsx `createEffect` autosave — читает `appStore.score`
      и пишет через `repo.saveScore` с `setTimeout(500)`"
  - statement: "Существующий пакет `rollback-and-retry` (sha 25e83e0)
      supersede'ится через этот пакет — новый packet должен иметь
      `supersession: math/rollback-and-retry/` в frontmatter (или
      добавить post-create вручную, тк CLI broken)"
    marker: fact
    evidence: "math-coding convention — supersession связь explicit
      в YAML; manual edit OK пока CLI сломан"
  - statement: "Кнопки `↶` / `↷` — Unicode arrow symbols, есть
      в любой системной шрифте; совместимы с iOS Safari рендером
      (system font)"
    marker: fact
    evidence: "Unicode 6.0 / 5.0 — U+21B6 / U+21B7; iOS 13+ гарантирует"
  - statement: "Debounce 600ms эмпирически: оптимизирует burst
      ввод (typing) и остаётся короткой для explicit edits (после
      правки → следующий undo отменяет всю правку, не следующее
      character edit)"
    marker: judgment
    evidence: "стандартное web IDE-правило — 500-1000ms grouping"
  - statement: "Миграция scorePrev → history/future не нужен: drop
      поля на read; новый код читает только history/future. Старая
      persisted score остаётся, но UI использует новые поля"
    marker: fact
    evidence: "IDB schema — `repo.loadScore()` возвращает string,
      reducer initial `history=[]` независимо"
---
