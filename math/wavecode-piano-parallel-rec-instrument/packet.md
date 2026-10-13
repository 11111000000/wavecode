---
proposition: |
  Piano-клавиатура играет ЧЕРЕЗ ОТДЕЛЬНЫЙ Web Audio synth
  (oscillator + gain + ADSR на каждую ноту) — НЕ через
  `AudioEngine.eval()`. Это гарантирует: (a) piano не
  прерывает main score (Strudel scheduler не
  перезапускается); (b) noise/click при rapid press
  устранён (нет рестарта scheduler каждые 30ms);
  (c) piano играет ПАРАЛЛЕЛЬНО с любой композицией.
  Дополнительно: Rec-toggle → ноты пишутся в буфер и
  при release dispatчатcя в `replaceScore` через
  `stack(existingScore, noteSeq)`. Instrument selector:
  triangle / sine / sawtooth / square.
antithesis: |
  (1) «Почему не `stack(currentScore, pianoSnippet)` через
  eval?». Возражение: каждый tap/release дёргает eval →
  `repl.stop()` + `repl.evaluate()` → audible click и
  потеря master scheduler continuity. Это и есть текущий
  баг ("прерывает основной трек"). Прямой Web Audio
  bypass эту проблему. (2) «Два audio sources — out of
  sync, drift». Возражение: Piano — percussive
  (envelope 0.4s decay), Strudel scheduler — long-form
  loops. У них разные time-scales; даже если piano
  стартует на 5ms позже, юзер не слышит (ADSR attack
  5ms уже в самом pianoVoice). (4) «Web Audio synth
  беднее чем Strudel voices». Возражение: Piano — это
  простой synth (triangle/sine/saw/square); пользователь
  хочет минимум (как в garage band), а не full Strudel
  chain. Routing через Strudel бы требовал `note(...).s(
  'triangle')` для каждой ноты, что мы и делали — но
  тот же restart-bug. (5) «Rec-mode: сложно
  синхронизировать ноты с Strudel clock». Возражение:
  rec-mode пишет MIDI-семни (number), конвертит в
  Strudel `note("c4")`-tokены. Rec это per-note ON/OFF,
  не per-cycle. UX — 100-я нормальный. (6) «Instrument
  selector — feature creep». Возражение: пользователь
  явно попросил («можно выбрать инструмент пианино
  должно быть»). Selector — 4 опции, не feature bloat.
synthesis: |
  Шесть компонентов:

  (a) `infrastructure/audio/PianoSynth.ts` (new): типизи-
  рованный `PianoSynth` объект с методами
  `noteOn(midi: number, instrument: PianoInstrument) →
  voiceId`, `noteOff(voiceId: number)`. Один
  `OscillatorNode + GainNode` на каждую активную ноту;
  ADSR: attack 5ms, decay 400ms, sustain 0.1, release
  100ms. Per-instrument: `triangle` (default),
  `sine`, `sawtooth`, `square`. Gain rampы
  используют `audioCtx.currentTime + delta` —
  никакого `setInterval`. Cleanup: voice disposed
  на release +50ms tail.

  (b) `infrastructure/audio/PianoSynth.test.ts` (new):
  * noteOn создаёт oscillator/gain, gain ramps
    проставлены в audioCtx.currentTime+attack/decay.
  * noteOff останавливает oscillator и ramps gain до
    0 за release ms; освобождает refs.
  * polyphony 5 нот = 5 одновременных oscillators.
  * Instrument switch в active voice → release old,
    start new с новым waveform (atomic swap).

  (c) `domain/music/notes.ts` (modify): новый экспорт
  `PianoInstrument = 'triangle' | 'sine' | 'sawtooth'
  | 'square'` + helper `pianoInstrumentToOscType(inst)` →
  OscillatorType. Без Web Audio import — pure тип.

  (d) `presentation/state/pianoRecStore.ts` (new):
  сигналы `recEnabled: () => boolean`,
  `recBuffer: () => NoteEvent[]`,
  `instrument: () => PianoInstrument`,
  setters + `toggleRec()`, `setInstrument(i)`,
  `appendNote(midi, at)`, `flushRec()` (последний
  обнуляет buffer и возвращает Strudel snippet).
  RecEnabled по умолчанию false.

  (e) `presentation/components/PianoKeyboard.tsx`
  (modify, ~40 line changes): 
  - Удалить `evalScore(buildPianoSnippet(...))` и
    accumulator-based eval-логику.
  - playNote(midi) → `pianoSynth.noteOn(midi,
    instrument()); const voiceId = ...`. Если rec on →
    `pianoRecStore.appendNote(midi, now)`.
  - stopNote(voiceId) → `pianoSynth.noteOff(voiceId)`.
  - activeSet остаётся только для VISUAL feedback
    (клавиша подсвечивается) — accumulator семантика,
    НО не вызывает eval.
  - 30ms debounce на rapid press ОСТАВЛЁН — теперь
    это debounce на `noteOn` чтобы избежать повторов
    при held MIDI re-trigger.

  (f) `presentation/components/PianoToolbar.tsx`
  (new): rec toggle (FAB mini magenta), instrument
  selector (4 кнопки в шапке piano-ряда). Rec-active
  пульсирует (animation). Rec toggle при включении
  сразу диспатчит `replaceScore(stack(score,
  recSnippet))` где recSnippet пустой при первом
  toggle, наполняется по мере rec. Disable-rec:
  `flushRec()` → пустой stack(слой удаляется из score).

  Visual:
  - PianoToolbar вверху piano-wrap, рядом с hint.
  - Instrument-кнопки 24×24px с активным state=
    border-amber + fill-amber-soft.
  - Rec-кнопка magenta, при включении pulse.

  Rec-mode flow:
  - toggle on → сразу `dispatch(stack(score, ""))`
      (пустой rec-layer для будущего append).
  - tap+release на пианино → recBuffer.push({note,
      duration}).
  - toggle off → recBuffer в score (если непустой).
  - Если rec ON и юзер стирает ИИ-edit или score
    становится пустым → НЕ теряем rec-buffer; flushRec
    возвращает Strudel-snippet который можно
    использовать через Apply.

  Tests:
  - vitest: PianoSynth.test.ts (new, 8 cases).
  - vitest: pianoRecStore.test.ts (new, 5 cases):
    * toggleRec() flips recEnabled.
    * appendNote(midi, t) добавляет в buffer с duration.
    * flushRec() возвращает Strudel snippet + clears
      buffer.
    * setInstrument(i) сменяет; не теряет буфер.
    * activeRange(): recent N events in order.
  - vitest: PianoKeyboard.test.ts (modify, +10 cases):
    * tap key → activeSet содержит midi; main score
      НЕ изменился.
    * tap+release → activeSet пуст; main score НЕ
      изменился.
    * tap + rec on → flushRec() возвращает snippet
      с note('X').s('triangle').duration(Y).
    * tap 5 нот chord → 5 voiceIds, 5 active oscillators.
    * instrument change → active voices получают
      новый waveform (через instrument signal getter).
  - vitest: notes.test.ts (modify): +pianoInstrumentToOscType
    test (4 cases).
  - playwright e2e: `tests/e2e/piano-parallel.spec.ts`:
    * загрузить preset → play (eval OK) → tap piano →
      assert main score === preset score (NOT replaced).
    * tap piano + rec ON → toggle off → assert score
      содержит `stack(` ... `,note("...")`.
    * instrument change (sine) → tap → assert oscType
      через audio context snapshot.
substrate: |
  + `ui/src/infrastructure/audio/PianoSynth.ts` (new,
    ~120 lines): typed wrapper над Web Audio API.
  + `ui/src/infrastructure/audio/PianoSynth.test.ts`
    (new, ~150 lines, 8 cases).
  + `ui/src/domain/music/notes.ts` (modify, +15 lines):
    PianoInstrument type + pianoInstrumentToOscType.
  + `ui/src/domain/music/notes.test.ts` (modify, +4 cases).
  + `ui/src/presentation/state/pianoRecStore.ts` (new,
    ~80 lines).
  + `ui/src/presentation/state/pianoRecStore.test.ts`
    (new, ~100 lines, 5 cases).
  + `ui/src/presentation/components/PianoKeyboard.tsx`
    (modify, ~40 line changes): evalScore-uses-PianoSynth.
  + `ui/src/presentation/components/PianoKeyboard.test.ts`
    (modify, +10 cases).
  + `ui/src/presentation/components/PianoToolbar.tsx`
    (new, ~80 lines): rec toggle + instrument selector.
  + `ui/src/presentation/components/PianoToolbar.test.tsx`
    (new, ~100 lines, 4 cases).
  + `ui/tests/e2e/piano-parallel.spec.ts` (new,
    ~120 lines, 3 cases).
  + `math/wavecode-piano-parallel-rec-instrument/
    {packet.md,witness}`.
  − DELETED: pianoSynth.ts (replaced by infra PianoSynth).
  − DELETED: notes.ts `multiNoteSnippet` / `buildPianoSnippet`
    (больше не нужны — обход через PianoSynth). singleNoteSnippet
    оставлен для возможного reuse.
status: applied
witness:
  applied_at: 2026-10-13
  commit: 3855be2
  supersedes: math/wavecode-piano-polyphony/packet.md
  notes: |
    Implementation: PianoSynth (infrastructure/audio/PianoSynth.ts)
    exposes typed Web Audio wrapper with noteOn/noteOff/setInstrument/
    activeCount/dispose. PianoKeyboard now routes audio through it
    instead of evalScore — recBuffer accumulates notes only when REC
    is on (no score mutation). PianoToolbar exposes REC toggle +
    instrument selector. 41 test files / 487 tests pass. PianoKeyboard
    test guards `evalScore not called` as a regression for the
    "interrupts main track" bug. Supersedes wavecode-piano-polyphony
    because that packet assumed `evalScore` was the correct path —
    but that is the source of the "interrupts main track" bug. Web
    Audio bypass is the structural fix.
axiom: A5
epistemics:
  - statement: "Web Audio OscillatorNode + GainNode —
    стандартный путь для percussive synth в браузере
    (MDN документирован)."
    marker: fact
    evidence: "MDN Web Audio API: `AudioContext.createOscillator`
      + `AudioContext.createGain` + `gain.linearRampToValueAtTime`
      is the documented ADSR-путь. testBeep в LiveAudioEngine.ts:146-158
      — это reference implementation в нашем же коде."
  - statement: "Strudel scheduler (`repl.evaluate`) запускает
      заново — observable как click/pop в audio output."
    marker: fact
    evidence: "LiveAudioEngine.ts:344-346: `repl.stop(); await
      repl.evaluate(snippet)`. Cyclist scheduler создаёт
      новый Query object, привязывает к AudioContext clock;
      переход слышен как micro-click при активной ноте."
  - statement: "Piano не должно ИЗМЕНЯТЬ Strudel score —
      это закон, не feature; иначе юзер теряет состояние."
    marker: judgment
    evidence: "axiom A5 (math-coding docs/axioms.md): 'The
      user's mental model is part of the API. Surface the
      model that the user already holds.' Юзер нажимает
      пианино — модель: «звучит». Юзер играет preset —
      модель: «эта композиция играет». Обе модели НЕ
      пересекаются — piano не должно трогать preset."
  - statement: "Rec-mode — буфер событий с timestamps
      конвертится в mini-pattern `note(snippet)` при
      flush. Это типовая DAW-семантика."
    marker: fact
    evidence: "Ableton Live MIDI record: ноты с timestamp
      хранятся в piano-roll clip; при stop записываются
      в take. То же — GarageBand, FL Studio. Buffer
      pattern — стандарт индустрии."
---