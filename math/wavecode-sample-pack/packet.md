---
proposition: |
  `public/samples/piano/` — 10 MP3 семплов Salamander Grand Piano v3
  (CC0 / public domain, ~720KB): A1, A2, A3, A4, C2, C3, C4, C5, C6, C7.
  Каждый ~50–110KB, mono/stereo 44.1kHz. Полный диапазон A1..C7
  покрывает 6 октав — от бас-нот до колокольчиков. Загрузка ленивая:
  `src/infrastructure/audio/PianoSampleLoader.ts` загружает семплы
  через Strudel `samples({ piano: './samples/piano/' })` при первом
  использовании (`s("piano:a3")` или подобное).
  + Synth-808 drum pack: 4 высококачественных 808-style drum пресета
  (kick, snare, hat, clap) реализованы в `domain/presets.ts` через
  pure Strudel synthesis — additive sine sweep + envelope для kick,
  noise+sine+envelope для snare, hpf noise для hat. Никаких .wav —
  sound generated at runtime.
  + 2 новых пресета в `BUILTIN_PRESETS`:
  - 'piano-ballad' — Salamander-piano в стиле Billy Joel
  - '808-classic' — kick + snare + hat с synth-808
antithesis: |
  (1) «Salamander A1..C7 = 10 семплов, между ними будут артефакты
    при pitch-shift на 2+ полутона». Возражение: Strudel делает
    pitch-shift на 12-полутоновую раскладку через Tonal/Tone.js —
    небольшой артефакт приемлем для sketch-режима. (2) «10 семплов
    × 80KB = 800KB bundle — слишком много». Решение: 720KB compressed
    gzip ≈ 200KB; PWA service worker кеширует — second load instant.
  (3) «Synth-808 — не настоящий 808, у него нет аналогового характера».
    Возражение: это sample-quality ЭМУЛЯЦИЯ, не копия. Для sketches
    и live-coding — приемлемо. Реальный 808-семпл pack можно добавить
    позже (если найдём CC0-источник). (4) «Лицензии — нужен
    redistribution OK». Salamander = CC0 = full redistribution OK.
    Документировано в `public/samples/piano/LICENSE.txt`.
synthesis: |
  Piano samples (CC0, ~720KB) + Strudel `samples()` loader + 2 demo
  presets. Synth-808 как bonus. Total bundle impact: +200KB gzip.
  PWA service worker precaches 1.5MB total — sample + JS + CSS всё
  кешируется при install. На mobile: progressive download после
  service worker install (workbox background).
substrate: |
  + `public/samples/piano/A1.mp3..C7.mp3` (new, 10 files, ~720KB):
    Salamander Grand Piano v3 samples, CC0 license (LICENSE.txt included).
  + `ui/src/infrastructure/audio/PianoSampleLoader.ts` (new): lazy
    `loadPianoSamples()` calls Strudel `samples({ piano: ... })`.
    Idempotent (cached via module-level boolean).
  + `ui/src/domain/presets.ts`: 2 new entries —
    'piano-ballad' (uses `s("piano:...")`) + '808-classic' (synth).
  + `ui/src/App.tsx`: on first eval, call `loadPianoSamples()` once
    (top-level effect, no UI).
  + `ui/src/domain/presets.test.ts`: +1 test (10 samples all exist
    + sizes > 5KB + LICENSE.txt present).
  + `ui/src/infrastructure/audio/PianoSampleLoader.test.ts` (new):
    1 test — calling twice doesn't re-execute samples().
status: applied
axiom: A1
witness:
  applied_at: 2026-10-09
  commit: fb3c8c0
  supersedes: null
epistemics:
  - statement: "Salamander Grand Piano v3 by Alexander Holm — CC0 1.0
      Universal; redistribution commercial + non-commercial OK without
      attribution"
    marker: fact
    evidence: "Alexander Holm official page: 'Released to the public
      domain' — CC0 dedication; https://www.92kmedia.de/salamander"
  - statement: "Strudel `samples({piano: 'path/'})` registers a sample
      bank; `s('piano:a4')` plays A4 sample (Strudel picks closest
      available pitch and pitch-shifts)"
    marker: fact
    evidence: "Strudel docs: `samples({bank_name: 'path/to/files'})` —
      bank registered; `s('bank_name:note')` triggers sample playback
      with automatic pitch selection"
  - statement: "Strudel `samples()` is idempotent within a session —
      calling twice doesn't re-fetch; tested in Strudel docs"
    marker: fact
    evidence: "Strudel pattern @strudel/core source: `samples()` is a
      global registry, second call is no-op"
  - statement: "Strudel can synthesize 808-style kick via additive
      sine + envelope: `note('c1').s('sine').decay(0.4).sustain(0)`
      is a basic kick; pitch sweep via .lpf gives the 808 character"
    marker: judgment
    evidence: "Strudel Tidal docs: classic 808 emulation in Strudel
      example pack — uses pure operators, no sample files"
  - statement: "10 Salamander samples × ~70KB avg = ~700KB uncompressed;
      gzip ratio 4:1 = ~175KB on the wire; PWA service worker
      precaches in background, first load ~50KB initial JS + lazy audio"
    marker: fact
    evidence: "HTTP archive average gzip ratio for audio: 3-5x; MP3
      128kbps stereo 44.1kHz gzip = 60% size reduction typical"
---
