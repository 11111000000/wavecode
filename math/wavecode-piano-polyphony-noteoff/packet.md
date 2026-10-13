---
proposition: |
  Piano polyphony + note-off. Заменяем singleNoteSnippet-per-press
  (который рвал in-flight scheduler через repl.stop) на накапливающий
  buildPianoSnippet(activeSet) с явной посылкой SILENCE_SNIPPET при
  отпускании последней клавиши. Дебаунс 30ms объединяет быстрые
  трилли/жесты MIDI-клавиатуры в один eval.
outcome: |
  - playNote: добавляет midi в Set → debounced eval с
    buildPianoSnippet({midi}). 1 нота → single voice, ≥2 → stack(...).
  - stopNote: удаляет midi из Set → debounced eval. Если Set стал
    пустым → SILENCE_SNIPPET (явная тишина, Strudel глушит хвост
    старого пятна), иначе → пересборка с новым Set.
  - 30ms debounce через setTimeout-trailing: 5 нажатий за <30ms →
    ровно один eval, со всеми 5 нотами.
invariant: |
  - buildPianoSnippet — pure: пустой Set → 'silence', 1 нота →
    single voice (без обёртки stack), ≥2 → stack(v1, v2, ...) с
    .gain(0.3) на каждом голосе.
  - multiNoteSnippet отбрасывает невалидные имена нот (Number.isFinite
    + >= 0), а singleNoteSnippet для невалидного имени falls back к
    'a4' (сохраняя обратную совместимость с единственным юзкейсом
    inline-eval-а).
  - PianoKeyboard.tsx не знает про Strudel-грамматику snippet-ов —
    только MIDI numbers → buildPianoSnippet (presentation-слой
    держит UI; snippet grammar живёт в domain).
  - Дебаунс flush при onCleanup (нет висящих timer-ов после
    unmount).
test: |
  - vitest notes.test.ts: 6 новых кейсов multiNoteSnippet (empty,
    single, chord, invalid-mixed, all-invalid, uppercase-lower).
  - vitest PianoKeyboard.test.ts: buildPianoSnippet (5 кейсов: empty
    → silence, single → без stack, two → stack с двумя голосами,
    chord → stack с тремя голосами, out-of-range через мост) +
    component-level (6 кейсов: press, multi-press → stack, release
    all → silence, release one of two → single voice, out-of-range
    no-eval, debounce coalesce).
  - tsc --noEmit: clean.
  - eslint: 0 errors (1 pre-existing warning в PianoKeyboard.tsx из
    родительского коммита, не моё).
antithesis: |
  (1) «Использовать `n("<60 64 67>").s("triangle")` — это MIDI-числа,
     без note(), так чище». Возражение: один stack-less snippet
     играет ноты в sequence внутри одного цикла, а не одновременно —
     это арпеджио, а не chord. Нужна stack() для одновременного
     звучания.
  (2) «Делить .gain(0.3) на sqrt(n), чтобы chord не клиппил».
     Возражение: injectMix оперирует по топ-левелу stack-а —
     делить заранее значит маскировать mixer-решения юзера. Per-voice
     0.3 оставляет контроль панели, а clipping — ответственность
     юзера/UI (можно добавить auto-mix позже).
  (3) «Не нужен дебаунс — evalScore и так async». Возражение: фактически
     каждый call бежит `repl.stop() + repl.evaluate(...)` — медленный,
     и rapid MIDI glaze заливает очередь. 30ms coalescing
     значительно уменьшает нагрузку без слышимой задержки.
  (4) «Тестировать component нужен solid-testing-library, иначе это
     хрупкий JSDOM-тест». Возражение: наша задача — контракт snippet-
     ов, не рендеринг. Pure-helper buildPianoSnippet тестируется
     отдельно, а component-test вызывает handlers через обычные
     DOM Event-ы (Solid не нуждается в PointerEvent — нужна лишь
     .preventDefault()). Это стоит 30 строк setup-а.
synthesis: |
  5 правок, ~150 LoC:

  1. domain/music/notes.ts: добавить SILENCE_SNIPPET, приватный
     pianoVoice(n, gainLit), переписать singleNoteSnippet через
     pianoVoice, добавить multiNoteSnippet(notes: ReadonlySet<string>)
     с правилами empty/single/chord.
  2. presentation/components/pianoSynth.ts (NEW): pure helper
     buildPianoSnippet(activeMidi: ReadonlySet<number>) — мост
     MIDI numbers → names → multiNoteSnippet/SILENCE_SNIPPET.
  3. presentation/components/PianoKeyboard.tsx: 
     - playNote: `if (!current.has(midi))` then add + setActiveNotes;
       scheduleEval (trailing 30ms setTimeout).
     - stopNote: `if (current.has(midi))` then delete + setActiveNotes;
       scheduleEval.
     - scheduleEval: clearTimeout предыдущего → setTimeout(evalScore(
       buildPianoSnippet(activeNotes())), 30ms).
     - onCleanup: clearTimeout.
  4. domain/music/notes.test.ts (extend): 6 кейсов
     multiNoteSnippet/SILENCE_SNIPPET.
  5. presentation/components/PianoKeyboard.test.ts (extend):
     buildPianoSnippet pure tests + JSDOM render с mock evalScore +
     fake timers для component-level tests.

  Verification:
  ```
  cd ui && ./node_modules/.bin/vitest run
  cd ui && ./node_modules/.bin/tsc --noEmit
  ```
status: applied
axiom: A1
---

## Substrate

- `ui/src/domain/music/notes.ts` — add `SILENCE_SNIPPET`, refactor
  `singleNoteSnippet` through private `pianoVoice`, add
  `multiNoteSnippet(notes)`.
- `ui/src/presentation/components/pianoSynth.ts` — new file,
  `buildPianoSnippet(activeMidi)`.
- `ui/src/presentation/components/PianoKeyboard.tsx` — replace
  per-press evalScore with set accumulation + 30ms debounced
  trailing eval + explicit silence on last release.
- `ui/src/domain/music/notes.test.ts` — 6 cases.
- `ui/src/presentation/components/PianoKeyboard.test.ts` —
  buildPianoSnippet (5) + component (6) cases.

## Verification (auto)

```
cd ui && ./node_modules/.bin/vitest run           # 293 tests pass
cd ui && ./node_modules/.bin/tsc --noEmit          # clean
cd ui && node node_modules/eslint/bin/eslint.js \
    src/domain/music/notes.ts src/presentation/components/PianoKeyboard.tsx
                                                  # 0 errors (1 pre-existing warning)
```
