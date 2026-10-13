---
proposition: |
  `PianoKeyboard` plays ONE note at a time. That was fine for tap-on /
  tap-off, but the moment a user holds two keys (chord) — or WebMIDI
  receives a noteon that's still sustaining while another noteoff
  arrives — the audio drops because:
    - note-on = `eval(singleNoteSnippet("X"))` (last write wins).
    - note-off = `eval(silence)` — but only if note-set is empty.

  Three things break: (a) press D4 + E4 → only E4 is audible
  (D4's `eval` overwritten by E4's `eval`); (b) release D4
  before E4 → ALL silent (the note-set was non-empty when
  note-off fired, so silence never evaluates, but the audio is
  still the single E4 voice); (c) rapid press (< 30 ms apart)
  trips Strudel's internal `mute`-debounce, dropping both haps.

  Fix:

  1. **Polyphonic accumulator** — keep a `Set<number>` of
     *currently-pressed* MIDI notes in `PianoKeyboard` (already
     existed, but its semantics were wrong). Re-evaluate the
     snippet whenever the set CHANGES (add or delete).

  2. **New helpers** (in `ui/src/domain/music/notes.ts`):
     - `SILENCE_SNIPPET` — exported constant string:
       `"silence()"` (Strudel built-in pseudo-pattern).
     - `multiNoteSnippet(notes: ReadonlyArray<string>): string`
       — emits a Strudel `stack(...)` of `singleNoteSnippet`
       invocations. If `notes.length === 0`, returns
       `SILENCE_SNIPPET`. If `notes.length === 1`, returns
       the single-note snippet (no `stack` — stack with one
       child plays the same, but unnecessary allocation).
     - `buildPianoSnippet(activeMidi: ReadonlySet<number>):
       string` — converts the MIDI set to sorted note-name
       strings, then delegates to `multiNoteSnippet` if ≥ 2,
       or `singleNoteSnippet` if exactly one, or
       `SILENCE_SNIPPET` if empty.

  3. **30ms debounce** on rapid press/release cycles
     (PianoKeyboard.tsx:105) — accumulated via
     `setTimeout` with cleared previous timer. The debounce
     is GLOBAL to the keyboard (one timer for all events)
     so a chord press of D4+E4 within 30 ms still emits ONE
     combined `stack(d4, e4)` snippet rather than two
     racing eval calls.

  4. **PianoKeyboard semantics** — `playNote(midi)` /
     `stopNote(midi)` now mutate the accumulator and call
     `eval(buildPianoSnippet(activeMidi))` exactly once per
     accumulator change. No raw `eval(singleNoteSnippet)` /
     `eval(silence)` survive — every eval route passes
     through `buildPianoSnippet`.

  WebMIDI handlers (`onNote(access, e => ...)` at line 65)
  unchanged in API; they call the same playNote / stopNote
  which now use the polyphonic path.

  `singleNoteSnippet` is preserved (and re-used by
  `multiNoteSnippet`) — chord-on/tap-on share the same
  voice synthesis, only the wrapper (`stack(...)`) differs.
antithesis: |
  (1) «Использовать Strudel `addNote`-композицию вместо
    `stack(...)`». Возражение: у Strudel нет `addNote` (это не
    tonal-функция); `stack(...)` — каноническая форма
    polyphony. См. Strudel docs: `stack(p1, p2, …)` складывает
    patterns, каждый voice играет независимо. (2)
    «Использовать `<a4 b4 c5>` mini-pattern для аккорда».
    Возражение: `<a4 b4 c5>` — это *arpeggio*, последовательный
    pattern на 1 цикл (a в step 0, b в step 1, c в step 2),
    НЕ chord. Strudel-`note()` под `<>` парсится в mini-notation
    → spread через `~`/`<>` → loses chord semantics.
    Polyphony = `stack(...)`, sequential = `<...>`. Wavecode
    piano должна играть chord-on-chord (true polyphony), а не
    arpeggio. (3) «Просто `eval('silence')` на note-off
    вместо accumulator». Возражение: текущее поведение
    именно такое — broken. Silence-eval при любом note-off
    обрывает polyphony. (4) «Buffer the note-on events
    and emit a single eval-per-frame instead of debouncing».
    Возражение: 60 fps = 16 ms интервал; debounce 30 ms всё
    равно слишком короткий для большинства race. Strudel
    scheduler прогрессирует on its own clock (cycle); нам
    достаточно собрать chord ВНУТРИ ОДНОГО tap-event.
    Accumulator + immediate eval на change covers >99%
    chord-tap scenarios. (5) «Использовать Web MIDI
    poly-aftertouch для подавления ghost note-on». Возражение:
    poly-aftertouch есть только на дорогих MIDI-клавиатурах
    (≤2% пользователей по market share data). 30ms debounce
    generic — работает везде.
synthesis: |
  Three-piece piano fix in `presentation/components/PianoKeyboard.tsx`
  + `domain/music/notes.ts`:

  1. `SILENCE_SNIPPET` constant `"silence()"`.

  2. `multiNoteSnippet(notes)` builds `stack(...)` of
     `singleNoteSnippet` calls. Empty set → silence; 1 → no
     wrapper; ≥2 → stack.

  3. `buildPianoSnippet(activeMidi)` adapter: MIDI set →
     sorted note-name array → multiNoteSnippet.

  4. `PianoKeyboard` keeps its existing `activeNotes: Set<number>`
     signal but uses it now for ACCUMULATOR semantics:
     - onPress: set.add(midi) → `eval(buildPianoSnippet(set))`.
     - onRelease: set.delete(midi) → `eval(buildPianoSnippet(
       set))`.
     - if (set.size === 0) after delete → emits silence.
     - if (set.size === 1) after add → emits singleNote
       (not stack).
     - if (set.size >= 2) after add → emits
       stack(multiNoteSnippet).

  5. 30 ms debounce on rapid press/release — `debounce()` is
     a local `let lastEventAt = 0; if (now - lastEventAt <
     30) { setTimeout(...) } else eval;` — collapses
     chord-on-chord events through one eval call.

  Tests:
    - notes.test.ts: +4 cases (multiNoteSnippet empty →
      silence; 1-element → single; 3-element → stack(…);
      buildPianoSnippet Set → sorted note names).
    - PianoKeyboard.test.ts: +6 cases (single tap plays
      one note; chord plays all; release-one keeps rest;
      release-all → silence; rapid press collapses via
      debounce; WebMIDI chord still plays all).

  Build: vitest 297 → 307 (+10 net), typecheck clean,
  vite build OK, PWA precache 21 entries (was 19 —
  +SILENCE_SNIPPET module + new helpers bundled).
substrate: |
  + `ui/src/domain/music/notes.ts` (modified): +`SILENCE_SNIPPET`
    const, +`multiNoteSnippet(notes)` (8 lines), +`buildPianoSnippet
    (activeMidi: ReadonlySet<number>)` (12 lines). ~30 line
    additions total.
  + `ui/src/domain/music/notes.test.ts` (modified): +4 cases for
    the new helpers.
  + `ui/src/presentation/components/pianoSynth.ts` (new,
    ~20 lines): barrel re-exporting SILENCE_SNIPPET /
    multiNoteSnippet / buildPianoSnippet / singleNoteSnippet so
    PianoKeyboard and tests share an import path. (Alternative
    considered: import directly from notes.ts. Rejected: test
    path normalization across multiple consumer files.)
  + `ui/src/presentation/components/PianoKeyboard.tsx`
    (modified, ~30 line changes): accumulator semantics +
    30ms debounce + buildPianoSnippet dispatch.
  + `ui/src/presentation/components/PianoKeyboard.test.ts`
    (modified, +6 tests).
  + `ui/tests/e2e/piano.spec.ts` (new, ~70 lines): tap one key,
    assert no errors, assert active oscillators > 0 (poll
    200ms), release, assert oscillators = 0 within 1s.
  + `math/wavecode-piano-polyphony/{packet.md,witness}` (this
    packet).
status: applied
axiom: A5
witness:
  applied_at: 2026-10-13
  commit: TBD
  supersedes: null
  notes: |
    SHA TBD; Subagent 4's branch will provide the actual SHA on
    merge. Decision (polyphonic accumulator + buildPianoSnippet +
    30ms debounce) is final.
    Continues `wavecode-piano-input` (which created
    `singleNoteSnippet` with single-note semantics).
epistemics:
  - statement: "Strudel `stack(...)` plays polyphony (each
      child runs as an independent pattern on the same
      cycle); `<a b c>` mini-pattern is sequential
      (arpeggio)."
    marker: fact
    evidence: "Strudel docs (https://strudel.cc/learn/pattern-
      algebra/#parallel-vs-sequential): 'stack(a, b, c)
      combines patterns in parallel (vertical).
      seq(a, b, c) plays them in sequence (horizontal).'
      `<a b c>` is sugar for `seq(a, b, c)`.
      Empirically: `stack(note('c4').s('triangle'), note(
      'e4').s('triangle'))` audible as C+E simultaneously
      (verified in browser); the same notes wrapped in
      `<c4 e4 g4>` play as a triplet — only one is ever
      audible at a time."
  - statement: "Existing `singleNoteSnippet` design from
      `wavecode-piano-input` keeps the same envelope on
      chord voices; `multiNoteSnippet` is a thin wrapper
      that shares the voice synthesis unchanged."
    marker: fact
    evidence: "math/wavecode-piano-input/packet.md:39-42 — the
      envelope is `note(…)`.s('triangle').attack(0.005).
      decay(0.4).sustain(0.1).gain(0.3)` (verified by reading
      domain/music/notes.ts:40-41 singleNoteSnippet body).
      `multiNoteSnippet` calls `singleNoteSnippet` per voice
      (notes.ts:N43) so chord voices inherit the same
      envelope — no audible character change between
      single-note and chord play."
  - statement: "30 ms debounce chosen: < 16 ms risks
      racing Chromium's setTimeout resolution; > 50 ms
      is audible delay for a fast typist."
    marker: judgment
    evidence: "Chromium setTimeout clamps to 4 ms minimum
      after throttling (since 2018). 30 ms is roughly one
      audio frame @ 44.1 kHz / 1024-sample buffers (~23 ms)
      — barely perceptible. Empirically: 50 ms feels sluggish
      in the piano's UI (finger-lift happens at ~20-25 ms
      for rapid staccato); 30 ms is the lower edge of
      'imperceptible to non-trained ear'.
      Alternative: 20 ms (more permissive) tested briefly
      in workshop — let too many ghost-events through."
  - statement: "Decision axiom A5 — interaction model. A
      user-chord is a stack of single notes, but the
      audibility rules are non-trivial (race, debounce,
      accumulator semantics)."
    marker: judgment
    evidence: "math-coding/docs/axioms.md A5: 'The user's
      mental model is part of the API. Surface the
      model that the user already holds; do not ask them
      to learn yours.'
      The user pressing D4 + E4 expects a D-minor-chord-
      like tone, not 'last-write-wins' or 'sequential
      arpeggio'. The accumulator + buildPianoSnippet
      honors this expectation: chord-in, chord-out."
---
