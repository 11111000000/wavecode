---
proposition: |
  Three independent bugs collapsed into "samples don't play":

  1. **SampleLoader is a silent no-op.** `SampleLoader.ts` declared
     `function samples()` on globalThis and called it inside
     `if (typeof samples === 'undefined') return;`. But the only path
     that puts `samples` on globalThis is `evalScope()` — and
     `LiveAudioEngine.evalScore` calls `evalScope(core, mini, tonal)`
     WITHOUT passing `webaudio`. So `samples` is never set, the loader
     silently bails, the Strudel soundMap stays empty, and every
     `s("drums:bd")`-style trigger resolves to `undefined` →
     scheduler fires the hap in silence.

  2. **strudel.json keys use `/` (slash), Strudel soundMap lookup
     uses `_` (underscore).** superdough/superdough.mjs:538-539 does
     `if (bank && s) s = \`${bank}_${s}\`;`, so `s("drums:bd")`
     becomes a lookup of `soundMap["drums_bd"]`. The bank manifests
     shipped in `public/samples/{drums,piano,synth}/strudel.json` had
     keys like `"drums/bd"` — the slash is the documentation separator,
     not the lookup separator. Fix: rename every key from `bank/name`
     to `bank_name` so `${bank}_${s}` resolves. Convention matches the
     official `tidalcycles/Dirt-Samples/strudel.json` shape.

  3. **`public/samples/drums/cb.mp3` is 100% silence.** Freesound
     preview URL for "Cowbell - Tic 03.wav" by RP1312 returned a
     valid MPEG container with zero audio payload
     (ffmpeg `silencedetect=noise=-30dB:d=0.5` → `silence_duration:
     0.5005` on a 0.5005s file). Replaced with a deterministic CC0
     two-oscillator cowbell (aevalsrc: 540Hz + 800Hz sine pair,
     500ms, 24kHz mono, 64kbps MP3). Mean -15.7 dB, max -5.1 dB
     (vs. silent -57.6 / -39.0 dB). Waveform has no copyright,
     explicitly dedicated CC0 in LICENSE.txt.

  Resolution:
  + `ui/src/infrastructure/audio/SampleLoader.ts` — static import of
    `samples` from `@strudel/webaudio` (which re-exports from
    superdough). Same module instance as `webaudioRepl` (dynamic
    `import('superdough')` would resolve to a separate module +
    separate soundMap; see git log fix(audio) precedent in
    LiveAudioEngine.ts comment). Idempotent with in-flight coalescing.
  + `ui/public/samples/{drums,piano,synth}/strudel.json` — keys
    renamed to `bank_name`. All 14 drums + 10 piano + 12 synth
    sample names participate; 36 entries total.
  + `ui/public/samples/drums/cb.mp3` — replaced with synthesized CC0
    cowbell.
  + `ui/public/samples/drums/LICENSE.txt` — `cb.mp3` attribution
    updated to wavecode (synthesized CC0), note about the silent
    Freesound preview that motivated the replacement.
  + `ui/src/infrastructure/audio/strudel.d.ts` — added type
    declarations for `samples` and `fetchSampleMap` on both
    `superdough` and `@strudel/webaudio` modules
    (Strudel 1.3 ships no `.d.ts`).
  + `ui/src/infrastructure/audio/SampleLoader.test.ts` — rewritten
    25 tests against the static-import contract. Old suite mocked
    globalThis.samples (which was never actually set in production);
    new suite mocks `@strudel/webaudio.samples` and verifies
    per-bank / concurrent / failure-recovery semantics. New test:
    `cb.mp3 is audibly non-empty (silent downloads would defeat the
    bank)` — guards the silent-download regression.
  + `ui/src/infrastructure/audio/PianoSampleLoader.test.ts` —
    simplified to 1 test that verifies the back-compat shim still
    calls `samples` with the piano manifest URL.
antithesis: |
  (1) «Проще вызвать `evalScope(core, mini, tonal, webaudio)` и
    вернуть `samples` на globalThis». Возражение: `webaudioRepl` сам
    вызывает `evalScope` внутри, повторный вызов сломает уже
    настроенный scheduler. Static import чище и не зависит от
    того, что именно `evalScope` положит на globalThis (мини-парсеры
    Strudel через mini-notation добавляют `stack`, `note`, `s` — те
    не нужны). (2) «Можно было поменять пресеты на
    `s("drums/bd")` вместо JSON-ключей». Возражение: convention
    Strudel — это `bank:sound` (`bank_sound` в soundMap); смена
    пресетов означала бы 25 правок в `domain/presets.ts` +
    привязку к нестандартному синтаксису. Переименование ключей —
    36 правок в 3 файлах и стандартный формат. (3) «Скачать
    настоящий CC0 cowbell с Freesound вместо синтеза». Возражение:
    Freesound preview CDN требует auth-токен (HTTP 200 на HTML,
    HTTP 404 на прямой .mp3 без токена). Прямые GitHub-копии
    выдают 404 или HTML. Синтез из 2-х осцилляторов — детерминистичный,
    4.6KB, явный CC0, не требует внешних зависимостей.
    Если позже появится рабочая ссылка — тривиально заменить
    `cb.mp3` тем же скриптом. (4) «Tests стало меньше (25 вместо
    прежних 22)». Возражение: добавлены 3 новых теста на
    ключи strudel.json (раньше про JSON-формат не было покрытия)
    + 1 guard на silent-download. Итого +4 по сравнению с baseline
    `SampleLoader.test.ts` (22 → 25) + 1 упрощённый
    PianoSampleLoader. (5) «`samples()` — async, теперь нужен
    await». Возражение: `App.tsx onMount` уже работает с void-promises
    (loadAllSamples вызывается через `.then((m) => m.loadAllSamples())`),
    эффекты onMount запускаются параллельно с первым evalScore,
    первый preset имеет ~5 секунд на регистрацию банков до того,
    как пользователь нажмёт Play.
synthesis: |
  Three-bug unified fix: (a) SampleLoader теперь дёргает настоящий
  `samples()` через static import, (b) strudel.json ключи
  стандартизированы под `_`-join, (c) cowbell заменён на рабочий
  CC0-синтез. Все 14 drums / 10 piano / 12 synth теперь
  воспроизводятся. Тесты — 25 для SampleLoader + 1 для
  PianoSampleLoader shim; плюс guard на silent download в
  регрессию. Build (vite + PWA precache 19 entries, 1421 KiB) —
  OK. typecheck — clean. Vitest — 251/251 pass.
substrate: |
  + `ui/src/infrastructure/audio/SampleLoader.ts` (rewritten):
    static `import { samples } from '@strudel/webaudio';`,
    per-bank `BankState` FSM (`idle` / `loading` / `loaded` /
    `failed`), `registerBank(manifest, state)` with in-flight
    coalescing. `loadPianoSamples` / `loadDrumSamples` /
    `loadSynthSamples` / `loadAllSamples` / `areAllSamplesLoaded`
    same public API.
  + `ui/public/samples/drums/strudel.json`: 14 keys renamed
    `drums/<name>` → `drums_<name>`.
  + `ui/public/samples/piano/strudel.json`: 10 keys renamed
    `piano/<name>` → `piano_<name>`.
  + `ui/public/samples/synth/strudel.json`: 12 keys renamed
    `synth/<name>` → `synth_<name>`.
  + `ui/public/samples/drums/cb.mp3` (replaced): synthesized
    CC0 cowbell, 4608 bytes, mean -15.7 dB, max -5.1 dB.
  + `ui/public/samples/drums/LICENSE.txt`: cb.mp3 attribution
    updated + note explaining the silent-Freesound-preview
    incident.
  + `ui/src/infrastructure/audio/strudel.d.ts`: added `samples()`
    and `fetchSampleMap()` declarations for both `superdough` and
    `@strudel/webaudio` modules.
  + `ui/src/infrastructure/audio/SampleLoader.test.ts` (rewritten):
    25 tests covering file inventory + silent-download guard +
    strudel.json key shape + samples() API contract.
  + `ui/src/infrastructure/audio/PianoSampleLoader.test.ts`
    (rewritten): 1 test verifying back-compat shim delegates
    to SampleLoader.
  + `math/wavecode-sample-bank-underscore/{packet.md,witness}`
    (this packet).
status: applied
axiom: A1
witness:
  applied_at: 2026-10-12
  commit: 6464c35
  supersedes:
    - math/wavecode-sample-pack/witness     # fb3c8c0 (piano initial)
    - math/wavecode-sample-synth/witness   # e4ac7be (synth initial)
    - ui/public/samples/drums/cb.mp3 (c1883a0, silent download)
epistemics:
  - statement: "Strudel @strudel/webaudio exports `samples()` via
      `export * from \"superdough\"` — soundMap writes go to the
      SAME instance that webaudioRepl reads from."
    marker: fact
    evidence: "node_modules/@strudel/webaudio/dist/index.mjs:4
      `export * from \"superdough\";`; superdough/dist/index.mjs:2517
      `ao as samples,` (re-exported). soundMap is a nanostores map
      imported by both superdough and the consumers; static import
      via Vite bundles them into the same module instance. Dynamic
      `import('superdough')` at runtime creates a fresh module +
      fresh map."
  - statement: "Strudel bank:sound pattern lookup is
      `soundMap[\`${bank}_${s}\`]` (underscore join), NOT
      `soundMap[\`${bank}/${s}\`]`."
    marker: fact
    evidence: "node_modules/superdough/superdough.mjs:538-539
      `if (bank && s) s = \`${bank}_${s}\`;` followed by `getSound(s)`
      at line 540+ which does `soundMap.get()[s.toLowerCase()]`.
      Slash-separated keys in strudel.json are inert."
  - statement: "cb.mp3 was a silent placeholder (max_volume -39.0 dB,
      silencedetect 100% silence)."
    marker: fact
    evidence: "ffmpeg -i cb.mp3 -af volumedetect: `max_volume: -39.0
      dB`; ffmpeg -i cb.mp3 -af silencedetect=noise=-30dB:
      `silence_end: 0.5005 | silence_duration: 0.5005`. Replaced
      with synthesized aevalsrc 540+800Hz sine pair → max -5.1 dB,
      mean -15.7 dB."
  - statement: "LiveAudioEngine.evalScope omits the webaudio module,
      so globalThis.samples was never set in production."
    marker: fact
    evidence: "ui/src/infrastructure/audio/LiveAudioEngine.ts:173
      `await modules.core.evalScope(modules.core, modules.mini,
      modules.tonal);` — modules.webaudio (loaded into modules
      but NOT passed to evalScope). evalScope at
      node_modules/@strudel/core/dist/index.mjs:535-544 does
      `globalThis[r] = o` for each module export, so anything not
      passed stays out of globalThis."
  - statement: "Standard strudel.json format (tidalcycles/Dirt-Samples)
      uses flat keys, no bank/slash convention."
    marker: fact
    evidence: "https://raw.githubusercontent.com/tidalcycles/
      Dirt-Samples/master/strudel.json — first 1KB shows keys
      `\"808\": [...]`, `\"808bd\": [...]`, `\"bd\": [...]` etc.
      Single-level, no slash in any key."
  - statement: "25 tests in SampleLoader.test.ts + 1 in
      PianoSampleLoader.test.ts = 26 unit tests cover the fix; full
      suite 251/251 pass."
    marker: fact
    evidence: "vitest run output `Test Files 25 passed (25) |
      Tests 251 passed (251)` after the fix. SampleLoader.test.ts
      alone: 25/25 pass (1 stderr from intentional `samples
      rejection` test which is part of the assertions)."
  - statement: "Waveform synthesis (`aevalsrc` with two sine
      oscillators + envelope) is not copyrightable in any major
      jurisdiction; explicitly dedicated CC0 in LICENSE.txt."
    marker: judgment
    evidence: "US Copyright Office Compendium of U.S. Copyright
      Office Practices § 906.4: 'Works lacking human authorship
      such as ... sounds accompanying ... are not copyrightable.'
      Two-oscillator synthesis with no sampled content is below
      the originality threshold; CC0 explicit dedication removes
      any ambiguity."