---
proposition: |
  PianoKeyboard имеет 3 ортогональных пользовательских намерения,
  которые текущая реализация (`wavecode-piano-parallel-rec-instrument`)
  либо не поддерживает, либо поддерживает сломанно:

  1. **Audition (default)** — играть параллельно композиции, score не
     трогать. Текущее поведение, но громкость пианино непропорциональна
     (`PEAK_GAIN = 0.3` на ноту → 4-нотный аккорд = 1.2 в миксе → clipping
     → психоакустическое маскирование основного трека). Юзер слышит
     «пианино заглушает трек», хотя scheduler продолжает играть.

  2. **Record** — нажимаемые ноты должны превратиться в Strudel-snippet
     в editor'е. Сейчас `pianoRecStore` буферизует ноты, но
     `flushRec()` никем не вызывается: «commit to score» был отложен
     как «future work» в исходном пакете. Rec — фикция.

  3. **Follow / Visualize** — когда score играет, клавиши пианино
     подсвечиваются согласно haps из scheduler (MIDI ноты из
     `compileAndQuery`). Не реализовано вообще.

  Решение — комбинация:

  (a) **Гейн-фикс**: `PEAK_GAIN = 0.10` per-voice + soft-limiter в
      master-gain ноде пианино (порог 0.7, ratio 4:1) — пианино
      больше не клиппит и не маскирует Strudel. 4-нотный аккорд = 0.40
      в миксе, попадает в баланс presetов (средний per-layer gain
      ~0.15-0.5).

  (b) **FOLLOW toggle** в `PianoToolbar`. При on: каждые 50ms через
      RAF опрашиваем `compileAndQuery(0, 1)` через `AudioEngine` →
      Set<number> текущих MIDI → подсветка клавиш с data-source="follow".
      Сочетается с pressed-клавишами (set union) — если юзер держит
      C4 и score тоже играет C4, подсветка от двух источников.

  (c) **Commit-action** для REC: кнопка `↑ apply` в `PianoToolbar`.
      На клике `flushRec()` → snippet (`note("c4").s("triangle")…`) →
      `dispatch({ type: 'replaceScore', text: stack(score, snippet) })`.
      Stack-wrap через `appendGridToScore`-патерн (reuses parser, не
      ломает существующий stack). Если buffer пуст — noop. REC
      остаётся on после apply (продолжаем писать).

  (d) **Семантика REC по умолчанию** — tap-and-hold, не tap-and-release.
      Каждое нажатие добавляет в buffer один note-event с
      `duration = 0.5s` (стандартный Strudel-deck). Это упрощает UX:
      пользователь не должен удерживать клавишу, чтобы получить ноту;
      tap = one note, release = ничего не делает (нота уже в buffer).
      Сложные ритмы (legato, staccato) — следующий пакет, не сейчас.

  Опционально (d'): **LIVE mode** — если и REC, и LIVE оба on,
      ноты сразу (на release) пишутся в editor как `stack(score, …)`,
      без буфера. Можно отложить в отдельный пакет.
antithesis: |
  (1) «Audition-mode это default — но зачем тогда явный
  toggle, если он default-off?». Возражение: FOLLOW не default-on
  (может визуально шуметь при длинных паттернах), поэтому это
  toggle. REC тоже не default-on (юзер может случайно нажать
  пианино, не желая мутить score). Audition — не toggle, это
  implicit «всё off».

  (2) «Гейн-фикс сломает существующих юзеров, которые привыкли
  к громкому пианино». Возражение: 0.3 на ноту при 4-нотном аккорде
  clipping-distorted — это не «громкость», это артефакт. Любой
  пользователь предпочтёт сбалансированный звук. Если кому-то
  нужно громче — есть master gain в Mixer panel.

  (3) «FOLLOW требует polling scheduler — это 20Hz CPU cost».
  Возражение: `compileAndQuery` уже используется в StepGrid и
  AudioRecorder; это дешёвая операция (cycles=1, ~0.1ms). Polling
  каждые 50ms = 20Hz × 0.1ms = 2ms/sec = 0.2% CPU. Приемлемо.
  Альтернатива: push-notification из scheduler, но Cyclist не
  предоставляет хук — пришлось бы патчить infra.

  (4) «REC + apply две кнопки — лишний UI». Возражение: apply —
  единственный способ избежать «нажал 50 нот, REC off — и что
  теперь?». Сейчас без apply это тупик. Commit-action обязателен.

  (5) «Tap=note (не hold) теряет legato/staccato». Возражение:
  advanced ритмика — следующая итерация. Стандартный 80% кейс
  (набросать мелодию) — tap=note. Если юзеру нужен rhythm-control,
  пусть использует StepGrid (он для этого и существует).

  (6) «Stack-wrap через appendGridToScore-parsing — overengineering».
  Возражение: парсер уже написан (`parseStackTopLayers` в
  domain/layers/parseStack.ts) и протестирован. Reuse > rewrite.
  Inline-парсинг 15 строк vs поддержка ещё одного формата score.
synthesis: |
  Шесть компонентов:

  1. **`ui/src/infrastructure/audio/PianoSynth.ts`** (modify):
     - `PEAK_GAIN = 0.10` (вместо 0.3).
     - Добавить master limiter: каждый voice's gain → masterGain
       (`audioCtx.createGain()` с `gain.value = 1.0`) → destination.
       Master compressor через `DynamicsCompressorNode`: threshold=0.7,
       ratio=4, attack=0.005, release=0.1, knee=6. Это soft-limits
       клиппинг при N одновременных нотах.
     - Тест в `PianoSynth.test.ts` расширяется: gain-баланс при 4-нот
       аккорде НЕ превышает 0.6 в peak.

  2. **`ui/src/infrastructure/audio/PianoSynth.ts`** + **`ui/src/domain/services.ts`**
     (extend AudioEngine interface):
     - Новый метод `getActiveHaps(window: [number, number]):
       Effect<ReadonlyArray<{ midi: number; begin: number; dur: number }>>`.
     - `LiveAudioEngine` реализация: reuses `compileAndQuery` (он уже
       возвращает NoteEvent[] с midi/startCycle/endCycle). Filter по
       window [currentCycle, currentCycle + 1).
     - Для sub-cycle resolution: если haps активны «сейчас» (begin
       ≤ currentCycle ≤ end), возвращаем их. Точность = длина цикла
       (1/0.5 = 2s) — для подсветки клавиш вполне достаточно.

  3. **`ui/src/presentation/state/pianoRecStore.ts`** (extend):
     - Новый селектор `commitSnippet(): string` — конвертит buffer
       в Strudel snippet `note("c4").s("triangle").attack(.005)…`
       (один note per buffer entry, не stack — order by startMs).
     - Экспорт `commitSnippet` — pure function, тестируется отдельно.
     - Существующий `flushRec` оставлен (для `apply` button).
     - Также добавить `noteToneSnippet(midi, instrument)` →
       `note("c4").s("triangle").attack(0.005).decay(0.4).sustain(0.1).gain(0.3)`
       — Strudel-эквивалент PianoSynth voice, для snippet'а.

  4. **`ui/src/presentation/components/PianoToolbar.tsx`** (modify):
     - Добавить `FOLLOW` toggle (magenta → cyan или новый tone).
     - Добавить `↑ apply` button (виден только если REC on И buffer
       не пуст). Disabled если buffer пуст.
     - Кнопка имеет aria-label="Применить записанные ноты к score".

  5. **`ui/src/presentation/components/PianoKeyboard.tsx`** (modify):
     - Новый signal `liveHaps: Set<number>` — обновляется через RAF
       poll когда FOLLOW on.
     - RAF loop (parallel to existing MIDI/devices state): если
       `followEnabled()`, опрашивает `AudioEngine.getActiveHaps()`,
       результат в `liveHaps`. Cleanup на unmount.
     - В JSX: `const active = () => pressedSet().has(midi) || liveHaps().has(midi)`.
       CSS-класс `.active` ставится в обоих случаях; data-source
       атрибут для различения в тестах (`data-source="pressed" |
       "follow" | "both"`).
     - `applyRecording` handler: `commitSnippet()` →
       `appendGridToScore(appStore.score, ...)` — нет, лучше прямой
       helper `stackAppend(appStore.score, snippet)`. Создать в
       gridState.ts или new `pianoRecStore.applyToScore(score)`.

  6. **`ui/src/presentation/components/PianoKeyboard.test.tsx`**
     (extend, +12 cases):
     - gain balance: 4-voice chord НЕ clipping (>0.6 peak).
     - commitSnippet: single note → `note("c4")…`.
     - commitSnippet: 3-note buffer → multi-line snippet с обёрткой.
     - apply action: REC on + tap C4+E4 → ↑ apply → score contains
       `stack(…, note("c4")…note("e4")…)`.
     - apply action: REC on + tap → ↑ apply → apply again → score
       contains TWO rec layers.
     - apply action: REC off → ↑ apply button is hidden.
     - FOLLOW toggle: on → scheduler playing → pressed-and-follow
       are unioned in `active` source.
     - FOLLOW toggle: off → no follow, only pressed.
     - FOLLOW + live play: score has note C4 → C4 piano key gets
       `data-source="follow"`.
     - FOLLOW + manual press: pressed C4 gets `data-source="both"`
       when score also plays C4.
     - FOLLOW + no audio: pressed-only, no follow.
     - 30ms debounce preserved under FOLLOW.

  Visual: keyboard-3-tones (existing: pressed=amber). Add
  `data-source="follow"` → cyan border. `data-source="both"` →
  amber fill + cyan border. CSS-update в `components.css`.

  Tests:
  - vitest: 12 new (см. выше)
  - e2e: новый `tests/e2e/piano-modes.spec.ts` (3 кейса):
    * gain balance (4-нот chord не искажает main track)
    * apply: REC on → tap → ↑ apply → score содержит snippet
    * follow: играет preset → C4 piano key получает data-source="follow"

  Substrate scope:
  - ~6 файлов modify, 1 файл new (commitSnippet helper), 1 файл new
    (e2e spec).
  - total ~250 LoC diff.

  Supersession of `wavecode-piano-parallel-rec-instrument` — старый
  пакет был правильной идеей (Web Audio bypass) но недоделанной
  реализацией (нет commit, нет follow, clipping). Этот пакет —
  структурное завершение.
status: applied
witness:
  applied_at: 2026-10-13
  commit: e52ae133bf6feeff6207d768f8f14d3962a0eb0a
  supersedes: math/wavecode-piano-parallel-rec-instrument/packet.md
  notes: |
    Implementation completed on 2026-10-13. Commit SHA
    e52ae133bf6feeff6207d768f8f14d3962a0eb0a on
    `feat/piano-modes-and-gain`. Test counts (vitest):
    628/628 passing (48 files). Net new tests: ~30 split across
    PianoSynth (gain balance + compressor config),
    pianoRecStore (followEnabled / commitSnippet / stackAppend /
    applyToScore), PianoToolbar (FOLLOW toggle + apply button),
    PianoKeyboard (data-source attribute defaults). Typecheck clean.
    No new lint errors. E2E spec added at tests/e2e/piano-modes.spec.ts
    with 3 cases (gain balance, REC apply, FOLLOW projection).
axiom: A5
epistemics:
  - statement: "PEAK_GAIN = 0.3 даёт clipping при 4-нотном аккорде:
      суммарная амплитуда = 0.3 × 4 = 1.2, выше 1.0 = hard clip.
      AudioContext.destination получает distorted сигнал,
      маскирующий Strudel-слои с gain(0.15) в типичных пресетах."
    marker: fact
    evidence: "ui/src/infrastructure/audio/PianoSynth.ts:82:
      `const PEAK_GAIN = 0.3;` — буквально в коде. Web Audio API
      sums gain nodes; peak amplitude = sum of simultaneous voice
      gains. 4×0.3 = 1.2 > 1.0 = hard clip. Strudel presets use
      gain(0.15) per layer (см. ui/src/domain/presets.ts Creep и
      Step Grid demo)."
  - statement: "DynamicsCompressorNode в Web Audio API — стандартный
      путь для soft-limiter в браузерном синте."
    marker: fact
    evidence: "MDN Web Audio: DynamicsCompressorNode с threshold,
      ratio, attack, release, knee параметрами. testBeep в
      LiveAudioEngine.ts:146 не использует (простой beeper), но
      superdough в production Strudel-пайплайне использует
      компрессоры для mixbus."
  - statement: "compileAndQuery уже возвращает NoteEvent[] с
      midi/startCycle/endCycle (см. LiveAudioEngine.ts:367-402).
      getActiveHaps — тривиальный filter на текущий cycle."
    marker: fact
    evidence: "ui/src/infrastructure/audio/LiveAudioEngine.ts:367
      export const compileAndQuery = Effect.tryPromise с returns
      NoteEvent[] (тип из domain/midi/encoder). Просто
      implementation: filter .filter(e => e.startCycle <= now
      && e.endCycle >= now)."
  - statement: "Декision axiom A5 — mental model. Юзер видит 3
      toggle (REC, FOLLOW, и implicit Audition=off/off). Это
      компонуемая ментальная модель: каждое намерение изолировано,
      комбинируются по необходимости. Противоположно «mode»
      (один enum), где намерения исключают друг друга."
    marker: judgment
    evidence: "axiom A5 (math-coding docs/axioms.md): 'The user's
      mental model is part of the API. Surface the model that the
      user already holds; do not ask them to learn yours.'
      GarageBand/Ableton: recording и monitoring — отдельные
      toggles, не один mode. Это индустриальный стандарт."
---