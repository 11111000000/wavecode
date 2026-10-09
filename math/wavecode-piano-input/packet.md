---
proposition: |
  В `.app-controls-row` появляется кнопка `🎹 Piano`. В on — над
  `<CodeMirrorEditor>` в `ScorePanel` рендерится `<PianoKeyboard />` —
  2-октавная on-screen клавиатура (24 клавиши: C3..B4), белая + чёрная
  раскладка. Tap/click = note-on (synth стаккато через `eval` single-note
  snippet), release = note-off (eval `silence`). Touch-friendly
  (whites 60×180px mobile, 80×220px desktop). При наличии WebMIDI
  (Chrome/Edge desktop, Android — НЕ iOS Safari) — auto-bind `navigator.
  requestMIDIAccess({sysex:false})` и входящие note-on/off с любого
  устройства отражаются на визуальной клавиатуре. iOS-юзеры получают
  только on-screen.
antithesis: |
  (1) «24-клавишная клавиатура перегружает UI». Возражение: 2 октавы
    = 24 клавиши, ~720px ширина. В ScorePanel`е есть место над
    editor'ом. (2) «Зачем WebMIDI если у юзера нет клавиатуры?».
    Возражение: iOS-юзеры получают on-screen, desktop-юзеры с MIDI
    клавиатурой получают hardware. (3) `eval` на каждый tap = много
    overhead. Решение: `eval` только на note-on (включая repeat через
    holding), на note-off `eval` тишины. (4) WebMIDI permissions могут
    зависнуть в `pending`. Решение: 1-секундный таймаут, fallback
    на on-screen. (5) Чёрные клавиши < 44px на мобиле. Решение:
    позиционируем absolute поверх whites на нужной x-позиции;
    hit-target увеличиваем через padding, не через размер.
synthesis: |
  Two-octave piano (24 keys) в ScorePanel:
  - Tap = note-on через `audio.eval(s('reverb/casio:note-X'))` — single
    note; release = `audio.eval('silence')` (встроенный Strudel
    pseudo-pattern).
  - Big whites (60×180 mobile / 80×220 desktop) + 16 black keys
    overlaid via absolute positioning.
  - WebMIDI: auto-detect, populate `inputs[]`, listen `midimessage`.
    On note-on: mark key active + trigger same audio.eval. On note-off:
    silence. iOS: WebMIDI returns undefined → UI silently hides MIDI
    status, only on-screen works.
  - Tests: pure fn `noteNumberToName(midiNum)` (C3..B4), pure
    `midiNoteToSampleName(num)` → 'a4'..'c5' for Strudel.
  - UI integration: App.tsx toggle, ScorePanel conditional render.
substrate: |
  + `domain/music/notes.ts` (new): `noteNumberToName(midi)` → 'C3',
    'A4', etc. + `midiToStrudelNote(num)` → 'c3', 'a4', etc.
  + `domain/music/notes.test.ts` (new): 16 cases (chromatic 1 octave).
  + `infrastructure/audio/MidiInput.ts` (new): `requestMidiAccess()`,
    `getMidiInputs(): MIDIInput[]`, `onNote(callback)` subscription
    manager. Web API only — fall back to empty array on iOS.
  + `presentation/components/PianoKeyboard.tsx` (new): 24 keys,
    touch + click + (optional) MIDI bind.
  + `presentation/components/PianoKeyboard.test.ts` (new): pure note
    name mapping.
  + `App.tsx`: `🎹 Piano` toggle в `.app-controls-row`; emits
    `wavecode:piano` CustomEvent.
  + `ScorePanel.tsx`: `<Show when={showPiano}><PianoKeyboard/></Show>`.
  + `index.css`: `.piano-keys`, `.piano-key.white`, `.piano-key.black`,
    `.piano-key.active` (highlight on press), 60×180 mobile → 80×220
    desktop via @media.
status: applied
axiom: A1
witness:
  applied_at: 2026-10-09
  commit: 2409f82
  supersedes: null
epistemics:
  - statement: "WebMIDI API: `navigator.requestMIDIAccess` Promise →
      MIDIAccess; `.inputs` Map of MIDIInput, `midimessage` event with
      `data: Uint8Array` (status + note + velocity)"
    marker: fact
    evidence: "MDN WebMIDI docs: standard API since 2015; status byte
      0x90+note = note-on, 0x80+note = note-off, 0xB0+ctrl = CC"
  - statement: "iOS Safari не поддерживает WebMIDI API (нет
      `navigator.requestMIDIAccess`); Android Chrome — поддерживает;
      desktop Chrome/Edge — поддерживает; Firefox — поддерживает"
    marker: fact
    evidence: "MDN WebMIDI browser compat: Safari iOS = ❌, Safari macOS
      = ✅, Chrome = ✅, Firefox = ✅, Edge = ✅"
  - statement: "MIDI note number 60 = Middle C (C4); A4 = 69;
      chromatic: C=0, C#=1, D=2, ..., B=11 within octave"
    marker: fact
    evidence: "MIDI 1.0 spec: note 60 = C4; `Math.log2(freq/440)*12 + 69`
      is the standard formula"
  - statement: "Strudel `note(\"a4\")` accepts scientific pitch notation;
      one-off patterns: `note(\"c4\").s(\"sawtooth\").decay(0.5).sustain(0)`"
    marker: fact
    evidence: "Strudel docs: scientific pitch notation `c4`, `a4`, etc.;
      `note()` accepts string + chain operators"
  - statement: "Strudel `silence()` pseudo-pattern produces no haps;
      useful for note-off evaluation"
    marker: fact
    evidence: "Strudel API: `silence()` — registered in @strudel/core
      as a no-op Pattern"
---
