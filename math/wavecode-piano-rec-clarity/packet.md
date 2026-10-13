---
proposition: |
  REC-режим пианино в wavecode страдает от двух связанных дефектов
  UX, которые существуют с момента `wavecode-piano-modes-and-gain`:

  (1) **Layout-разрыв.** Пианино живёт только как BottomSheet (full
  на mobile, ~70vh на desktop). CodeMirror — либо под ним (mobile),
  либо в 360px-drawer справа (desktop AI-primary). В обоих случаях
  в момент нажатия клавиш в REC-режиме юзер **физически не видит
  редактор**. Это скрывает место, куда пишется snippet, и убивает
  базовый feedback-loop «нажал → увидел что появилось».

  (2) **Slot-Ambiguity.** `applyToScore()` имеет единственный
  неявный режим — `stackAppend` в конец стека. Это работает для
  случая «добавить голос к существующей композиции», но не для:
    - «начать новую композицию из записанного» (нужен replace);
    - «вставить в конкретное место в редакторе» (нужен cursor insert).

  Один режим покрывает один сценарий из трёх естественных, и при
  этом сценарий никак не объявлен — пользователь должен угадывать,
  что `↑ apply` допишет в стек. Это и есть «неоднозначность», на
  которую натыкается юзер.

  Решение — связка из трёх ортогональных affordance'ов:

  (a) **Inline-piano через collapsible** в ScorePanel на desktop
      (≥1024px). Дефолт — collapsed (тонкая кнопка `▼ Piano` в
      header drawer'а / панели); expand → пианино выезжает на ~140px
      и сжимает CodeMirror на ту же величину. На code-primary
      (100% ScorePanel) места хватает без сжатия; на ai-primary
      (360px drawer) — squeeze, scrollable. Юзер **сам решает**,
      видеть пианино постоянно или по требованию. На mobile
      (≤720px) BottomSheet-piano **остаётся** — inline в BottomSheet
      full не помещается физически; вместо этого — preview-pill,
      который виден даже когда sheet перекрывает редактор.

  (b) **Slot-selector** — segmented control из 3 кнопок в PianoToolbar:
        ↵ stack   — текущее поведение (stackAppend в конец стека)
        ⟳ replace — destructive: `dispatch(replaceScore, snippet)`
        ⌖ cursor  — в позицию курсора через `view.dispatch(insert)`
      Селектор всегда виден (одна строка в toolbar), default = `stack`.
      **Не персистится** между сессиями: каждая загрузка стартует с
      `stack`. Слот `cursor` дополнительно требует `editorFocused()` —
      иначе disabled с tooltip «Тапните в редактор чтобы ставить ноты
      в курсор». Это даёт разумное поведение на mobile, где редактор
      бывает скрыт BottomSheet'ом.

  (c) **Preview-pill** в PianoToolbar — компактная капсула
      «● REC: 5 нот: C4 E4 G4 E4 C4 → ⌖ cursor». Показывает состояние
      буфера + активный слот **до** apply. На mobile висит поверх
      BottomSheet-full и виден даже когда редактор скрыт. При apply —
      капсула на 1.5s превращается в «✓ Применено», CodeMirror
      получает `EditorView.scrollIntoView` к первой вставленной строке
      + временный highlight через `Decoration.line` (CSS-class
      `.cm-line-flash`, fade-out 1.2s). Это даёт feedback независимо
      от того, где находится юзер в момент apply.

  Три affordance'а (collapsible, slot, pill) — **составные**: каждое
  работает независимо, но вместе закрывают обе исходные проблемы
  («размытость» + «непонятно куда»).
antithesis: |
  (1) «Collapsible piano съест ещё больше места в 360px drawer'е».
  Возражение: дефолт = collapsed. Default-state **не занимает**
  место в drawer'е (одна узкая кнопка `▼ Piano` 32×24px в header'е).
  Expand — opt-in. Юзер, который не записывает пианино, не платит
  за affordance.

  (2) «Почему слот не персистится в localStorage?».
  Возражение: слот `cursor` требует `editorFocused()`, который
  per-mount, не per-session. Если юзер вышел с `cursor` в slot, а
  вернулся — у редактора нет фокуса, и кнопка disabled. Это
  создаёт «забытый slot» UX-баг: «почему ⌖ серый?». Reset
  per-session устраняет класс таких багов. `stack` — дефолт и
  всегда рабочий; пользователь осознанно переключает на `cursor`,
  делает работу, может вернуть обратно.

  (3) «Replace без confirm-диалога — потеря данных».
  Возражение: в AppState уже есть `history`/`future` (multi-undo,
  пакет `wavecode-multi-undo`). Любой `replaceScore` отменяется
  одной `⌘Z`. Confirm-диалог — лишний клик при горячем flow
  «записал мелодию → начал новую композицию». Tooltip кнопки
  replace: «Заменит весь score. ⌘Z для отмены» — сообщает явно,
  но не блокирует.

  (4) «Live auto-apply полезнее — каждое нажатие сразу в score».
  Возражение: live auto-apply + `replace` = потеря работы при
  случайном нажатии. Слот `stack` + live = переполнение стека
  буферами нот (юзер нажал 200 нот за минуту — 200 строк в
  стеке). Буфер + manual apply даёт пользователю review-точку.
  Live mode — отдельный пакет `wavecode-piano-rec-live`, не здесь.

  (5) «Slot cursor на mobile сбивает с толку».
  Возражение: кнопка `⌖ cursor` disabled когда `editorFocused()`
  false. Tooltip объясняет: «Тапните в редактор чтобы ставить
  ноты в курсор». Юзер, который физически не видит редактор,
  не нажимает — кнопка серая. Если он тапнул в редактор
  (например, переключился на Score таб) — кнопка становится
  активной. Это согласуется с axiom A5: «surface the model
  user already holds» — модель «вставить туда, где курсор»
  известна из любого текстового редактора.

  (6) «Flash + scrollIntoView = overengineering ради cosmetic».
  Возражение: A1 — feedback. Apply — это commit, а не silent
  write. Если юзер не видит результат apply, он не уверен, что
  действие сработало. Это риск-в-награда: 20 строк кода ради
  уверенности юзера. Без feedback-loop REC становится чёрным
  ящиком.
synthesis: |
  Семь компонентов:

  1. **`ui/src/presentation/state/pianoRecStore.ts`** (modify, ~+80 строк):
     - Новый signal `pianoSlot: () => 'append-stack' | 'replace-score' | 'at-cursor'`, default `'append-stack'`. **Не персистится** — каждая сессия с дефолта.
     - `setPianoSlot(slot: PianoSlot)` — setter.
     - Новый signal `editorFocused: () => boolean`, default `false`.
     - `setEditorFocused(v: boolean)` — setter, вызывается из ScorePanel через view.contentDOM focus/blur listener.
     - Новый signal `pianoEditorApi: () => CodeMirrorEditorApi | undefined`, default `undefined`. Сеттер `setPianoEditorApi(api)` — ScorePanel вызывает его в `onReady`.
     - `applyToScore()` переписан: switch по `pianoSlot()`:
       - `'append-stack'`: текущая логика (`stackAppend(score, snippet)` → `dispatch(replaceScore)`).
       - `'replace-score'`: `dispatch(replaceScore, snippet)`. Buffer очищается.
       - `'at-cursor'`: получить `view` через `pianoEditorApi()?.getView()`. Если view нет — no-op + `console.warn`. Иначе:
         ```
         view.dispatch({
           changes: { from: cursor, to: cursor, insert: snippet },
           selection: { anchor: cursor + snippet.length },
           effects: EditorView.scrollIntoView(cursor + snippet.length, { y: 'nearest' })
         });
         ```
         Затем `flashLines(view, snippetLines)` — Decorations на вставленные строки на 1.2s.
     - Helper `flashLines(view, n)` — через `Decoration.line` + `setTimeout(removeDecoration, 1200)`. Чистый testable export.
     - Pure helpers `insertAtCursorSnippet`, `replaceScoreSnippet` — для unit-тестов.

  2. **`ui/src/presentation/components/PianoToolbar.tsx`** (modify, ~+50 строк):
     - Сегментированный slot-control между REC/FOLLOW и apply:
       ```
       [<button ↵ stack>] [<button ⟳ replace>] [<button ⌖ cursor>]
       ```
       Каждый — `data-active`, click → `setPianoSlot`. `⌖ cursor` имеет `disabled` когда `!editorFocused()`, `title` объясняет.
     - Preview-pill — компактная капсула справа от apply:
       ```
       <span class="piano-rec-pill">
         <span class="dot magenta pulse"/>
         REC: {count} нот: {first5NoteNames}{'+N еще' если > 5}
         → {humanSlotName(pianoSlot())}
       </span>
       ```
       Видим когда `recBuffer().length > 0`. При apply успехе → контент на 1.5s заменяется на «✓ Применено → {count} нот», потом возвращается (буфер уже пуст → pill сам скрывается).
     - `applyToScore()` остаётся на кнопке ↑ apply, но теперь читает slot.

  3. **`ui/src/presentation/components/PianoKeyboard.tsx`** (modify, минимально):
     - Сам компонент не меняет логику. Меняется **где** он рендерится.
     - Добавить export variant: `<PianoKeyboard variant="inline" />` и `<PianoKeyboard variant="sheet" />` — оба используют одну логику, разный CSS-контекст (`.piano-wrap--inline` vs `.piano-wrap--sheet`).
     - На desktop (`window.matchMedia('(min-width: 1024px)').matches`) → variant по умолчанию = inline. Mobile → sheet.

  4. **`ui/src/presentation/panels/ScorePanel.tsx`** (modify, ~+40 строк):
     - Новый signal `pianoCollapsed: () => boolean`, default `true` (на desktop). Persisted в `wavecode-piano-collapse-v1` localStorage.
     - В header'е ScorePanel (между preset-row и `<CodeMirrorEditor>`):
       ```
       <button class="piano-toggle" aria-expanded={!pianoCollapsed()}>
         ▼ Piano  <!-- или ▶ Piano если collapsed -->
       </button>
       ```
     - `<Show when={!pianoCollapsed()}>` → рендер `<PianoKeyboard variant="inline" />` ВНУТРИ `.score-panel-inner` (над CodeMirror, под score-debug).
     - В `onReady(api)` после `editorApi = api`: вызвать `setPianoEditorApi(api)`.
     - `createEffect` который отслеживает `editorApi`: подписаться на `view.contentDOM` focus/blur → `setEditorFocused(true|false)`. Cleanup на unmount + на изменение view.
     - Применяется на desktop (≥1024px). На mobile — `<PianoKeyboard>` не рендерится в ScorePanel (он в BottomSheet).

  5. **`ui/src/presentation/components/app/BottomSheets.tsx`** (modify, ~+5 строк):
     - Добавить `<BottomSheet kind="piano">` остаётся на mobile. На desktop убирается условно:
       ```
       <Show when={window.matchMedia('(max-width: 1023px)').matches}>
         <BottomSheet kind="piano" title="Piano" subtitle="WebMIDI auto-bind">
           <div class="piano-sheet-body"><PianoKeyboard variant="sheet" /></div>
         </BottomSheet>
       </Show>
       ```
       ScorePanel-inline перехватывает на desktop. Это **не дублирование** — variant="inline" и variant="sheet" рендерят один и тот же компонент с разным CSS-контекстом; mount/unmount одного инстанса.

  6. **`ui/src/styles/components.css`** (modify, ~+90 строк):
     - `.piano-slot-selector` — segmented control: flex row, gap 4px, каждый button — 28×28px, active = border-amber + fill-amber-soft, inactive = ghost.
     - `.piano-slot-btn[data-active="true"]` — amber.
     - `.piano-slot-btn:disabled` — opacity 0.4, cursor not-allowed.
     - `.piano-rec-pill` — pill-shape, padding 4×10, background var(--surface-2), border-left 2px magenta, mono font, font-size 11px.
     - `.piano-rec-pill .dot` — 6×6 magenta circle, pulse animation при `recEnabled`.
     - `.piano-rec-pill[data-applied="true"]` — green-tinted на 1.5s (CSS animation).
     - `.piano-toggle` — кнопка в header ScorePanel: 28×24, выравнивание по правому краю header'а.
     - `.piano-wrap--inline` — контейнер: padding 0, max-height 200px (для 360px drawer squeeze).
     - `.cm-line-flash` — animation: background fade-in yellow → transparent за 1.2s. Подсветка inserted lines.

  7. **`ui/src/presentation/components/PianoKeyboard.tsx`** (`<style>` block внутри, ~+15 строк):
     - Inline-variant добавляет `class="piano-wrap piano-wrap--inline"` (вместо дефолтного `piano-wrap`).
     - Sheet-variant — `class="piano-wrap piano-wrap--sheet"` (то же, что сейчас).

  Tests:
  - vitest: расширенный pianoRecStore.test.ts (+10 cases):
    * slot default = append-stack.
    * setPianoSlot cycles.
    * applyToScore append-stack: диспатчит replaceScore со stackAppend(snippet).
    * applyToScore replace-score: диспатчит replaceScore со snippet as-is.
    * applyToScore at-cursor без editorApi: no-op + console.warn.
    * applyToScore at-cursor с editorApi: вызывает view.dispatch c insert + scrollIntoView + flashLines.
    * editorFocused default false; setEditorFocused(true) → true.
    * slot не персистится: после перезагрузки модуля — default.
    * flashLines: создаёт decorations; после 1.2s убирает.
    * insertAtCursorSnippet pure: возвращает правильный changes object.
  - vitest: расширенный PianoToolbar.test.tsx (+6 cases):
    * 3 slot кнопки рендерятся с правильными aria-label.
    * ⌖ cursor disabled когда !editorFocused.
    * ⌖ cursor enabled когда editorFocused.
    * Preview-pill виден когда recBuffer.length > 0.
    * Preview-pill скрыт когда recBuffer пуст.
    * Click apply → вызывает applyToScore().
  - vitest: новый ScorePanel.test.tsx (+4 cases):
    * pianoCollapsed default true (desktop).
    * Click piano-toggle → показать/скрыть PianoKeyboard inline.
    * view.contentDOM focus → setEditorFocused(true) → PianoToolbar slot-cursor enabled.
    * При unmount EditorView → focus listener cleanup (no leaked listeners).
  - playwright e2e: новый `tests/e2e/piano-rec-slot.spec.ts` (5 cases):
    * Desktop @ 1440×900: AI-primary → ScorePanel 360px drawer → Piano toggle виден → click → пианино inline. Запики 3 ноты → ↑ apply → score содержит `stack(..., note...)`. Flash виден.
    * Slot replace-score: REC → 5 нот → click ⟳ replace → ↑ apply → score = snippet, history имеет предыдущее значение. ⌘Z → score восстановлен.
    * Slot at-cursor desktop: editor focus → ⌖ cursor enabled → REC → ↑ apply → snippet вставлен в позицию курсора (view.state.selection.main.from > 0).
    * Slot at-cursor desktop без focus: ⌖ cursor disabled, click no-op.
    * Mobile @ 412×900: Piano BottomSheet full → preview-pill виден в sheet'е → ↑ apply → score mutates. Slot at-cursor disabled (редактор скрыт sheet'ом).
  - playwright e2e: расширенный `tests/e2e/piano-modes.spec.ts` (+1 case):
    * Mobile slot at-cursor после переключения на Score таб + тап в editor → ⌖ cursor enabled.

  Substrate scope:
  - 6 файлов modify (~+260 строк), 1 файл new (e2e spec, ~+120 строк), 1 файл modify (CSS, +90).
  - Total ~470 LoC diff.
  - Зависимости: `EditorView.scrollIntoView` уже импортирован в `MiniNotationToolbar.tsx` — переиспользуем тот же паттерн.
  - Тесты: vitest расширения (~+200 строк), e2e новые (~+250 строк).

  Supersession / relations:
  - SUPERSEDES: ничего (новое решение; не конфликтует с `wavecode-piano-modes-and-gain`, а дополняет его — apply pipeline теперь slot-aware).
  - BUILDS ON: `wavecode-piano-modes-and-gain` (буфер + REC + FOLLOW уже работают).
  - BUILDS ON: `wavecode-ai-primary-layout` (360px drawer geometry определяет sizing inline-piano).
  - BUILDS ON: `wavecode-multi-undo` (history/future защищают destructive replace).
  - REUSES: `MiniNotationToolbar.dispatchInsertSnippet` паттерн (cursor insert + scrollIntoView).
  - REUSES: `StepGrid.flashKey` паттерн (transient visual feedback).
  - FUTURE: `wavecode-piano-rec-live` — live auto-apply, отдельный пакет.

  Risks:
  - Collapsible под 360px drawer: piano-height 200px + header + debug = ~280px из 360px drawer; CodeMirror остаётся с ~60px (минимально читаемо). Защита: drawer scrollable, editor внутри scrollable; если не влезает — пользователь collapse.
  - editorFocused signal: view.contentDOM пересоздаётся при lazy-load CodeMirror; re-attach listener при editorApi change. Если не сделать — флаг застрянет в `false`.
  - view.dispatch с insert + scrollIntoView + flash: три эффекта в одном dispatch. На огромном snippet'е (100+ строк) — flash на каждой строке = 100 decorations, потенциально медленно. Защита: flash только на первой и последней строке (визуально достаточно), или cap на 10 строк.
  - Mobile at-cursor: editor за BottomSheet-piano скрыт; кнопка disabled. UX-flow: пользователь переключает таб Score → BottomSheet закрывается → editor visible → tap → фокус. Это 2-3 тапа. Если юзер не понимает, кнопка остаётся серой. Tooltip критичен.
status: draft
axiom: A5
epistemics:
  - statement: "На desktop ≥1024px ScorePanel может быть 360px drawer (AI-primary) или flex-1 (code-primary) в зависимости от uiState.layout"
    marker: fact
    evidence: "ui/src/styles/components.css:1348-1362 (.app-body[data-layout='ai-primary']); ui/src/styles/components.css:2432-2440 (.score-panel flex-1 default)"
  - statement: "dispatchInsertSnippet в MiniNotationToolbar.tsx:48-56 уже использует EditorView.scrollIntoView(anchor, {y: 'nearest'}) для cursor-insert — это переиспользуемый паттерн"
    marker: fact
    evidence: "ui/src/presentation/components/MiniNotationToolbar.tsx:48-56 — export const dispatchInsertSnippet(view, snippet) с view.dispatch({changes, selection, effects})"
  - statement: "AppState.history/AppState.future дают multi-undo (wavecode-multi-undo applied 2026-10-12)"
    marker: fact
    evidence: "ui/src/domain/types.ts:46-48 — readonly history/future массивы; ui/src/application/reducer.ts replaceScore добавляет в history перед заменой"
  - statement: "Web Audio PianoSynth и pianoRecStore работают независимо от того, где PianoKeyboard рендерится — variant='inline' и variant='sheet' не требуют разной audio-логики"
    marker: fact
    evidence: "ui/src/presentation/components/PianoKeyboard.tsx — компонент не знает про layout; pianoSynth — closure-scope, не зависит от родителя; recBuffer — module-scope signal bag"
  - statement: "EditorView.contentDOM focus/blur listener работает на любом mount — не требует специальной интеграции с CodeMirror"
    marker: fact
    evidence: "CodeMirror 6 docs: contentDOM — стандартный HTMLElement, focusable; addEventListener('focus', ...) — стандартный DOM API"
  - statement: "StackAppend и replaceScore — ортогональные модели. Юзер имеет минимум 3 естественных сценария: (1) добавить голос к существующему стеку, (2) начать новую композицию, (3) вставить в конкретное место. Текущая реализация покрывает только (1)"
    marker: judgment
    evidence: "axiom A5 (math-coding): 'Surface the model that the user already holds.' Текстовые редакторы (VSCode, Notion, GarageBand) дают выбор insert/replace/append — это стандарт UX; юзеры уже знают эту модель"
  - statement: "Collapsible по умолчанию (collapsed=true) — лучший default, чем 'всегда видно'. Inline-piano в 360px drawer съедает место для редактора; большинство сессий — без REC"
    marker: judgment
    evidence: "axiom A1 (feedback): 'Surface intent, don't bury it.' GarageBand iOS — piano dock скрыт по умолчанию, появляется при нажатии record. Ableton Push — pads в режиме record, иначе — обычный session view. Toggleable affordance — стандарт DAW UX"
  - statement: "Destructive action без confirm — допустимо когда undo доступен и reversible cost низкая. Multi-undo (Cmd+Z unlimited через history) делает destructive-action не страшным"
    marker: judgment
    evidence: "axiom A1 (feedback): путь к обратимости существует (⌘Z). Confirm-диалог — artificial friction без реальной защиты; пользователь, который не знает про undo, всё равно его не нажмёт"
  - statement: "Slot at-cursor должен быть disabled когда editor нет focus — иначе view undefined → silent no-op + user confusion. Tooltip объясняет, кнопка остаётся серая"
    marker: judgment
    evidence: "axiom A5: surface the model. Модель 'insert at cursor' тривиально понятна, когда cursor есть; невалидна, когда нет. Disabled state — explicit 'not now', а не silent fail"
  - statement: "Preview-pill — единственный способ дать feedback о состоянии буфера, когда редактор физически скрыт BottomSheet'ом. Это composition of A5 (mental model: 'see what's queued') и A1 (feedback before commit)"
    marker: judgment
    evidence: "Ableton Live: record-arm показывает count of recorded events в toolbar ДО stop. GarageBand: 'Recording... 12 beats' pill в верхней панели. Это стандарт DAW UX"
  - statement: "Slot НЕ персистится: 'cursor' часто невалиден при следующей сессии (нет focus), 'replace' редко default' (юзер обычно хочет добавлять). Reset per-session устраняет 'forgotten slot' UX-bag"
    marker: judgment
    evidence: "axiom A5: модель 'начинаем с default' стабильнее, чем модель 'последний выбор'. iOS Settings — большинство toggle'ов default = ON, не 'remember last'. Это bias к safe-default"
  - statement: "Flash highlight через EditorView.decorations — стандартный CodeMirror 6 API для transient feedback. Альтернатива (CSS animation на cm-line) работает, но fragile при multi-line insert"
    marker: fact
    evidence: "CodeMirror 6 docs: EditorView.decorations.of([Decoration.line({...})]) — стандартный путь для inline-decorations. ui/src/presentation/components/MiniNotationToolbar.tsx:54 уже использует scrollIntoView эффект в dispatch"
---