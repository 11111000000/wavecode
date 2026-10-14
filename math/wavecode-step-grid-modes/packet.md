---
proposition: |
  StepGrid toolbar has three semantically-overloaded buttons
  (`↓ read score`, `↻ clear`, `↑ load & play`) and a tap-toggling
  4×8 grid that *looks* identical in every mode — but actually
  toggles a draft buffer, fires a one-shot Web Audio preview,
  and may-or-may-not be committed. Users cannot tell from the
  UI whether a tap will:
    (a) just preview a drum hit (current behavior),
    (b) commit the grid back into the editor's `stack(...)`,
    (c) edit one layer in-place.

  This is A4 (care) violation. Replace the three buttons with
  ONE mode pill (`view | sketch | edit`) that disambiguates
  the tap action *before* the user presses anything. Each mode
  has a clear contract:

    - view     → tap = preview only. Grid always mirrors score.
    - sketch   → tap = preview + toggle draft cell. "↑ commit"
                  button writes draft to score via
                  `appendGridToScore` + eval. Sheet close with
                  dirty draft shows a "discard/save/cancel"
                  dialog.
    - edit     → tap = preview + write that cell back to the
                  existing `s("…")` layer of the current
                  `stack(...)` and re-evaluate. Each tap is a
                  one-shot commit; no "save" step. Requires
                  score to be parseable as 4 `s("…")` rows
                  inside `stack(...)` — otherwise the mode is
                  gated with a tooltip.

  Persist `{ mode, draftGrid, lastCommittedGrid }` to IDB so
  reload restores intent.
antithesis: |
  (1) «Keep three buttons, just rename them». Возражение:
  renaming `↑ load & play` → `↑ commit` doesn't fix the core
  problem: the *meaning of a tap* changes per-mode but the
  visual state (flash + dot) doesn't. The user's question
  "что произойдёт если я нажму?" has three different answers
  depending on the toolbar state. A mode pill is the canonical
  UI affordance for "what does this control do RIGHT NOW"
  (Ableton Push Note Mode / Step Mode / Session Mode, FL
  Studio Pattern / Song / Mixer). Three buttons with renamed
  labels is still three distinct decisions to make; one
  mode-pill + a contextual action button is two decisions
  total.

  (2) «Always-commit-on-tap is simpler». Возражение: this is
  the OLD behavior (`wavecode-step-sequencer` packet) that was
  superseded by `wavecode-step-append-sync` *specifically*
  because it clobbered the user's main composition. Reverting
  that would be a regression. The current `appendGridToScore`
  path is safer (it wraps/splices instead of replacing), but
  still mutates the editor's text and pushes a history entry.
  A misclick in `view` mode must do NOTHING to the score.

  (3) «Edit mode is just sketch with auto-commit — why
  bother?». Возражение: sketch operates on a *separate
  draft*; edit operates *in-place on one layer*. In edit
  mode, tapping cell (0, 0) replaces just the first `s("…")`
  row's first token — preserving the rest of the score
  including any other `s("…")` rows the user added manually.
  Sketch's commit replaces the whole draft (all 4 rows) at
  once. These are different shapes of work:
    - "tweak my existing drum pattern" → edit
    - "I sketched a new 4-row beat from scratch" → sketch
  Confusing them is what the user is asking us to fix.

  (4) «Just hide the toolbar in view mode, keep two buttons
  for sketch/edit». Возражение: view mode needs to be
  discoverable. If the pill isn't there, new users won't know
  there's a "view" option. The pill must always be visible so
  users can return to view (the safe default) at any time.

  (5) «Edit mode is dangerous — what if score has 7 layers?».
  Возражение: the mode is GATED on `parseStackTopLayers`
  returning exactly 4 layers whose first token is `s(`. We
  reuse the same parser as `MixerPanel` (already in
  `domain/layers/parseStack.ts:168`). If the score isn't
  parseable into 4 `s("…")` rows, the mode button is
  disabled with a tooltip explaining why. This is a
  fail-safe — no accidental corruption of unrelated layers.

  (6) «Just persist in localStorage — IDB is overkill».
  Возражение: IDB is already wired through `Repo` and
  `useAutoSave` (500ms debounce, same pattern as score +
  messages). Adding a 4th key (`grid-state-v1`) costs ~10
  lines. localStorage has synchronous blocking, IDB has
  the same async plumbing we already use.

  (7) «Per-tap eval is too expensive, batch them with
  a long debounce». Возражение: per-tap `repl.evaluate` is
  ~25KB CPU + AudioWorklet reinit. `LiveAudioEngine` already
  exposes `setPattern(pattern, autostart=false)` (see
  `LiveAudioEngine.ts:99`) which swaps the parsed Pattern
  into the live scheduler at the next lookahead window
  without `repl.stop` + `repl.evaluate`. We reuse this
  exact same hot-swap path that `setLayerMix` already uses
  for the MixerPanel (debounced 50ms via
  `MIX_DEBOUNCE_MS`). No new mechanism.

  (8) «What if edit mode modifies a layer that was
  originally NOT in the grid's 4 rows?». Возражение: the
  gate `parseStackTopLayers(score)` + per-layer check
  that the first token is `s(` ensures we only touch
  `s("…")` rows. If a user had `s("bd ~ ~ bd ~ ~ hh ~"),`
  as the first row, edit-mode taps replace just the
  tokens in that row. Adjacent `note("…")` or `n("…")`
  rows are untouched.
synthesis: |
  Six changes:

  (a) `domain/music/gridTypes.ts`: add `GridMode = 'view' |
      'sketch' | 'edit'`, helpers `gridsEqual(a, b)` and
      `countGridDiff(a, b)` (returns number of cells that
      differ — drives the "N unsaved" badge).

  (b) `presentation/state/gridState.ts`: introduce three
      signals: `mode`, `draftGrid` (the *current* grid, what
      the UI renders), `lastCommittedGrid` (what's in the
      score at last commit/parse). Helpers:
        - `enterView(score)` — parse score into draft, mark
          lastCommitted=draft, mode=view.
        - `enterSketch(score)` — if lastCommitted empty,
          parse score; else keep current draft. mode=sketch.
        - `enterEdit(score)` — parse score into draft,
          lastCommitted=draft, mode=edit. REJECTS if score
          doesn't parse as 4 `s("…")` rows in a top-level
          stack (returns `{ ok: false, reason }`).
        - `commitDraft(score)` — returns new score via
          `appendGridToScore(score, draftGrid)` and
          advances lastCommitted=draft. Used by sketch's
          ↑ commit button.
        - `applyEditToLayer(score, draftGrid)` — pure
          in-place splice of 4 `s("…")` layers inside the
          existing stack (no double-wrap). Used by edit
          mode per-tap.
        - `dirtyCellCount()` — derives "N unsaved" from
          draftGrid vs lastCommittedGrid.

  (c) `application/useCases/editGridLayer.ts` (new, ~80
      lines): pure helper that takes (score, grid) and
      returns a new score where the 4 `s("…")` layers in
      the top-level `stack(...)` are replaced by
      `gridToScore(grid)`. Reuses paren-aware splitter
      already in `domain/layers/parseStack.ts:120`. The
      trick: the splitter returns layer sources, we
      pick the 4 whose first token is `s(`, replace
      each with the corresponding row from
      `gridToScore`, and rebuild the stack via
      `splitTopLevel` indices — no string surgery.
      If the score doesn't satisfy the precondition
      (≠4 s-layers, or non-stack score), the function
      returns `null` and the caller falls back to
      `appendGridToScore` (sketch semantics).

  (d) `presentation/state/audioActions.ts`: add
      `scheduleGridEdit(score)` — debounced 50ms hot-swap
      (same shape as `scheduleMixLive`). The hot-swap
      uses `setPattern` via the existing `setLayerMix`
      Effect — but wait, `setLayerMix` is for mixer
      state, not score. We need a NEW Effect
      `AudioEngine.setScore` for the edit-mode path.
      Adding this is a 1-line entry on the AudioEngine
      service interface + a 30-line impl in
      `LiveAudioEngine.ts:539` that calls
      `injectMix` + `repl.setPattern(parsedPattern)`.
      This is the same hot-swap path that already
      exists in the `setLayerMix` impl — it just
      doesn't go through `repl.evaluate` side effects.
      (See `LiveAudioEngine.ts:491-535` — the entire
      `setLayerMix` impl is the template; we copy it
      but read the score from a different source.)

  (e) `presentation/components/StepGrid.tsx`: rewrite
      the toolbar. Three-segment pill at the top:
        [ view ] [ sketch ] [ edit ]
      Mode-aware action button (right of pill):
        view:  (no button)
        sketch: `↑ commit (N unsaved)` if dirty,
                disabled otherwise
        edit:   (no button — every tap is a commit)
      Mode-aware tap handler:
        view:  previewSample only, no state change
        sketch: previewSample + toggleCellState +
                (no eval)
        edit:  previewSample + toggleCellState +
                applyEditToLayer + scheduleGridEdit
                (debounced 50ms internally)
      On sheet close (BottomSheet's onClose callback
      wired in App.tsx), if mode==sketch AND
      dirtyCellCount()>0 → show a confirm dialog
      with "discard / save / cancel". Implementation
      via SolidJS <dialog> element (no new deps).
      Visual: dirty cells get a brighter fill
      (CSS class `dirty`); committed cells keep the
      current thin-dot. This makes the "draft" state
      visible at a glance.

  (f) `infrastructure/repo/IDBRepo.ts` +
      `presentation/state/useAppBootstrap.ts`: add
      `KEY_GRID_STATE = 'wavecode-grid-state-v1'` and
      `Repo.loadGridState / saveGridState` (matching
      the existing pattern). `useAppBootstrap` reads
      grid state on mount and seeds the signals. After
      every commit (`commitDraft` or `applyEditToLayer`),
      a debounced 500ms save writes back. A separate
      `useGridStateAutoSave` (new, ~30 lines) wires
      the debounce. Same shape as `useAutoSave`.

  Tests:

  vitest `gridTypes.test.ts` (extend, +3):
    * `gridsEqual` — true on identical, false on diff.
    * `countGridDiff` — 0, 1, 4, 32 cell-diff cases.
    * `GridMode` type guard (compile-time).

  vitest `gridState.test.ts` (rewrite, ~150 lines):
    * `enterView` — sets mode=view, draft=parsed, lastCommitted=parsed.
    * `enterSketch` — fresh empty grid on empty score; parses on non-empty.
    * `enterEdit` — REJECTS on `note("c4")` (non-stack), REJECTS on
      `stack(note("c4"), s("…"))` (only 1 s-layer), ACCEPTS on
      `stack(s("…"), s("…"), s("…"), s("…"))` (exactly 4 s-layers).
    * `commitDraft` — sketch dirty → commitDraft returns
      `appendGridToScore(score, draftGrid)`; lastCommitted advances.
    * `applyEditToLayer` — see editGridLayer.test.ts.
    * `dirtyCellCount` — 0 when draft==lastCommitted, N when N cells differ.

  vitest `editGridLayer.test.ts` (new, ~120 lines):
    * 4-s-layer stack → grid cells replace s-rows verbatim.
    * 3-s-layer stack + 1-note row → grid replaces 3 s-rows, leaves note row.
    * Non-stack score → returns null (caller falls back to appendGridToScore).
    * Stack with comments / nested parens preserved.
    * Round-trip: gridToScore(g) → loadFromScore → equal to g.

  vitest `audioActions.scheduleGridEdit` (new, ~50 lines):
    * Debounced: 5 rapid calls within 50ms → 1 AudioEngine.setScore call.
    * setScore uses injectMix + repl.setPattern path (mock verifies).

  vitest `StepGrid.test.tsx` (rewrite, ~250 lines):
    * Modes render correctly (pill with 3 segments).
    * view-mode tap: previewSample called, draft unchanged, score unchanged.
    * sketch-mode tap: previewSample called, draft toggled, score unchanged.
    * sketch-mode ↑ commit: replaceScore + evalScore called.
    * edit-mode tap on parseable score: previewSample + setScore debounced.
    * edit-mode is DISABLED on non-parseable score (button has
      aria-disabled=true, tap on it is a no-op).
    * "N unsaved" badge appears in sketch when dirty.
    * Sheet close with dirty sketch → confirm dialog rendered.
    * Beat indicator still works (RAF polling unchanged).

  playwright e2e `tests/e2e/step-grid-modes.spec.ts` (new, ~120):
    * Open Creep preset → Step sheet → mode=view by default →
      grid shows Creep's drum cells (bd/sd/hh have notes).
    * Tap a cell in view → score UNCHANGED, audio still plays Creep.
    * Switch to sketch → tap → ↑ commit → editor now has
      `appendGridToScore(creep, draft)`.
    * Switch to edit → tap → score text differs in place at the
      s("…") row level, no extra layer.
    * Reload page → mode + draft + lastCommitted all restored from IDB.

  Regression: existing `tests/e2e/step-append.spec.ts` may need
  an update since "↑ load & play" button is replaced by
  "↑ commit (N unsaved)" in sketch mode. Update selectors.

  Не нужно менять:
  - `audioActions.previewSample` (works in all 3 modes).
  - `audioActions.evalScore` (used by sketch ↑ commit).
  - `gridState.loadFromScore` (reused by enterView/enterEdit).
  - `gridState.appendGridToScore` (still the sketch-commit path).
  - `LiveAudioEngine.setLayerMix` / `scheduleMixLive` (different
    path, untouched).
  - `domain/layers/parseStack.ts` (we use `parseStackTopLayers`
    and `splitTopLevel` directly, not forking).
  - `parseStackTopLayers` already has the
    "exactly-4-s-layers" detection (we just filter layers
    where firstToken starts with `s(`).
status: applied
witness:
  applied_at: 2026-10-14
  commit: pending
  supersedes:
    - math/wavecode-step-sequencer/packet.md
    - math/wavecode-step-append-sync/packet.md
    - math/wavecode-step-grid-autoload-and-sync/packet.md
  notes: |
    Three previous packets handled different slices of the same
    surface; this one unifies them. The new model is a
    mode-driven grid that explicitly disambiguates "what does
    a tap do" via a UI affordance, instead of a single
    implicit "preview-and-maybe-commit" path. Sheet-close
    confirm dialog + IDB persistence of the mode + draft
    address silent data loss on reload.
axiom: A4
epistemics:
  - statement: "StepGrid toolbar has 3 buttons; each button's
      label hides the real question (preview vs. commit vs.
      parse) and they're not visually distinct enough."
    marker: fact
    evidence: "ui/src/presentation/components/StepGrid.tsx:88-116
      — three buttons: '↓ read score', '↻ clear', '↑ load & play'.
      All three have the same `.step-grid-btn` class;
      only `↑ load & play` has the extra `step-grid-btn-primary`
      modifier. No mode indicator, no dirty badge."
  - statement: "User's report matches the spec gap: «Степ
      сейчас ни на что как будто не влияет... непонятно
      как это должно работать»."
    marker: observation
    evidence: "user message 2026-10-14 — describes tapping
      cells, hearing the preview oscillator, but no clear
      model of what the grid is doing relative to the
      score. The beat cursor moves because Strudel scheduler
      is playing the *score*, not the *grid*."
  - statement: "`appendGridToScore` is safe-ish but still
      mutates the editor's text and pushes a history entry
      on commit."
    marker: fact
    evidence: "ui/src/presentation/state/gridState.ts:174-203 —
      pure function returns new string. Caller in
      StepGrid.tsx:78 does `dispatch({type:'replaceScore',
      text: newScore})` which (per application/reducer.ts:79)
      snapshots the previous score into history. Undo works
      but the user's text was changed."
  - statement: "`LiveAudioEngine` already has a hot-swap
      path that bypasses `repl.evaluate` for layer-mix
      changes; edit-mode per-tap can reuse it without
      adding new infra."
    marker: fact
    evidence: "ui/src/infrastructure/audio/LiveAudioEngine.ts:99 —
      `setPattern?(pattern, autostart?)` on the repl handle.
      `:419-535` — outer `setLayerMix` impl uses
      `transpilerMod.evaluate` (compile only) +
      `repl.setPattern(parsedPattern, autostart=false)`.
      This is the established hot-swap pattern in the
      codebase."
  - statement: "`parseStackTopLayers` can detect a 4-s-layer
      stack: filter layers whose firstToken matches
      `^s\\s*\\(`."
    marker: fact
    evidence: "ui/src/domain/layers/parseStack.ts:30 — the
      `detectName` function already extracts the first
      function token via regex `/^([A-Za-z_$][\\w$]*)\\s*\\(/`.
      For our precondition: count layers where
      `firstToken === 's'`. Already in place; we don't
      need new parsing."
  - statement: "Sheet close behavior is currently silent
      data loss for the draft grid."
    marker: fact
    evidence: "ui/src/presentation/state/gridState.ts:21 —
      `const [grid, setGrid] = createSignal<Grid>(emptyGrid());`
      is a module-scope signal, NOT persisted to IDB.
      Reloading the page resets it. Closing the sheet
      (without unmount) keeps the grid in memory but
      the user has no signal that 'this is not saved'."
  - statement: "Existing e2e test `step-append.spec.ts`
      uses the button label 'load' to find the
      load-and-play button; the new sketch-mode
      'commit' button will require a label update."
    marker: fact
    evidence: "ui/tests/e2e/step-append.spec.ts:82, 112 —
      `page.locator('.step-grid button:has-text(\"load\")')`.
      Rename to `commit` in this packet; update the
      spec accordingly."
  - statement: "IDBRepo already has 2 keys (score, messages);
      adding a 3rd is a 1-line change to the repo + a
      30-line `useGridStateAutoSave`."
    marker: fact
    evidence: "ui/src/infrastructure/repo/IDBRepo.ts:12-13 —
      `KEY_SCORE`, `KEY_MESSAGES`. ui/src/presentation/state/
      useAutoSave.ts:13-42 — 30-line debounced pattern
      for both. We mirror this exactly for grid state."
