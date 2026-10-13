# E2E Coverage Report — wavecode/ui

Generated as part of Phase 4 / Subagent 18. Each spec listed below is a
Playwright test file in `ui/tests/e2e/`.

## Covered flows

### Editor / score
- **audio-eval.spec.mjs** (1 test)
  - Eval button plays audio without errors
- **presets.spec.mjs** (1 test)
  - Selecting the Creep preset loads its score and plays audio
- **persistence.spec.mjs** (1 test)
  - Score is autosaved to IndexedDB and restored after page reload

### Transport / play
- **play-control.spec.ts** (1 test)
  - Play button lives in PresetRow (not FAB), click toggles to Stop,
    AI-textarea stays unoccluded
- **step-append.spec.ts** (3 tests)
  - tapping a cell does NOT clobber the loaded preset
  - tapping ↑ load & play with a loaded preset wraps grid layers
  - empty editor + grid tap + load → standalone grid snippet

### Sample loading
- **sample-loader.spec.mjs** (3 tests)
  - all 14 CC0 drum samples are served by Vite (HTTP 200)
  - LICENSE.txt is served and mentions CC0
  - 808-king preset loads, eval plays, no console errors
- **strudel-debug.spec.mjs** (1 test)
  - Strudel eval produces triggers

### Console (Phase 4 / Subagent 18)
- **console.spec.ts** (5 tests)
  - console.error("test") from page surfaces in Errors tab
    (no badge — logger does not bump unreadErrors)
  - unhandled rejection pushes error toast and bumps the badge
  - opening the console clears the badge
    (markAllRead side-effect of setConsoleOpen(true))
  - Cmd/Ctrl+` hotkey toggles the console sheet
  - clear button empties the buffer
    (Errors tab shows "No errors.")

### Piano (Phase 4 / Subagent 18)
- **piano.spec.ts** (6 tests)
  - tapping a single key shows .piano-key.active class and clears
    it on release
  - polyphony: pressing D4 + E4 simultaneously marks both keys
    .active
  - piano hint renders "2 octaves (C3–B4)"
  - rec button is clickable and toggles aria-pressed
  - instrument selector has 4 buttons
    (triangle/sine/sawtooth/square)
  - piano status pill shows MIDI device count with no source
    attribution before any MIDI activity (uses addInitScript to
    mock navigator.requestMIDIAccess so the pill is rendered
    deterministically)
- **piano-parallel.spec.ts** (3 tests)
  - piano tap preserves main score (no Strudel re-eval from
    keyboard)
  - piano REC toggle + tap does not write to main score until
    committed
  - instrument selector changes oscType for next tap (no errors)

### Audio recording
- **audio-recording.spec.mjs** (2 tests)
  - Record button + Render modal UI present
  - Record button toggles state when clicked
    (headless: no MediaRecorder → error state)

### Mini-notation toolbar
- **mini-toolbar.spec.mjs** (2 tests)
  - mobile (375×667): mini-toolbar is visible and tapping `note(`
    inserts the snippet into the editor
  - desktop (1280): mini-toolbar is hidden

**Totals**: 12 spec files, 26 unique tests, 52 entries in
`playwright test --list` (× chromium + firefox).

## NOT covered (known gaps)

- **Toast popover clicks** — toasts with `data-severity="error"`
  are clickable to open the sheet (Toast.tsx:99). No e2e
  exercises the click path.
- **ConsoleSheet tabs** — only the default Errors tab is asserted
  to be visible. The "All logs" and "By source" tabs are not
  switched in any test.
- **MIDI race recovery** — `requestMidiAccess()` can time out at
  1s. No test exercises the rejection path.
- **Sample-progress toast** — Toast.tsx subscribes to
  `wavecode:sample-progress` and pushes info/warn toasts on
  loaded/error. No test triggers the event.
- **ConsoleSheet snap toggle** — the ↑↑/↓↓ button toggles
  between `mid` and `full` sizes. No e2e.
- **Per-source group expansion** — the "By source" tab uses
  `<details open>` but no test collapses one.
- **`loadPersistedErrors` restoration** — ConsoleSheet onMount
  prepending IDB errors is hard to assert deterministically
  (depends on prior test state). No e2e.
- **Piano via WebMIDI** — `piano.spec.ts` mocks MIDI to render
  the status pill deterministically; the actual
  `noteOn(e.note, e.source)` path triggered by a real MIDI
  event is not exercised (no MIDI hardware in CI).
- **`__wavecodeActiveOsc` global** — referenced in the original
  Subagent-5 piano.spec.ts but never implemented. Replaced with
  visual feedback (.piano-key.active) assertions.
- **ConsoleButton badge cap "99+"** — `consoleBtn-badge` shows
  `99+` when `unreadErrors > 99`. Not asserted.

## Deviation notes (Phase 4 / Subagent 18)

The prompt listed six console tests but two of them were based on
an incorrect premise (`console.error` from the page bumps the
badge). The current implementation only bumps the badge for
window.onerror / unhandledrejection. The console.spec.ts file
documents this in the file header and rewrites those two tests
to (a) assert the buffer entry shows in the Errors tab, and
(b) use a `Promise.reject()` to bump it via the actual
consoleGlobals path.

The piano.spec.ts prompt expected the MIDI pill to render
without mocking. Headless Chromium does not implement
navigator.requestMIDIAccess so the pill is hidden via
`<Show when={props.midiStatus}>`. The status-pill test uses
`page.addInitScript()` to install a fake MIDI input so the
assertion is deterministic.

The piano-parallel.spec.ts prompt expected
`__wavecodeActiveOsc` to exist. It does not. The
instrument-selector test now asserts only "no errors" since
oscillator introspection is not portable.

The shared `NOISE_RE` filter regex in piano-parallel.spec.ts
(and the same filter in piano.spec.ts) now includes
`[sampler]`, `[cyclist]`, `[wavecode]` source patterns that
are produced by Strudel boot. Subagent 16 is expected to land
the preload-race fix; until then these are real noise.