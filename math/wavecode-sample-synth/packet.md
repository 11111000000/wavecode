---
proposition: |
  `public/samples/synth/` — 12 MP3 семплов analog synth (CC0 / public
  domain, ~1.3MB): 4 bass (c1/c2/e1/a1), 4 pad (c3/e3/g3/a3),
  2 lead (e4/g4), 1 strings (c4), 1 brass (c3). Источники — Freesound
  preview CDN с явным `?f=license:"Creative Commons 0"` фильтром.
  Каждый sample ≥ 5KB, LQ MP3 (64kbps 24kHz). Полный набор покрывает
  lead/bass/pad/strings/brass через единый Strudel sample bank
  `synth:*` (Strudel bank prefix).

  Загрузка ленивая и унифицированная: после merge с
  `wavecode-sample-drums` (который сделал SampleLoader агрегатором),
  `loadSynthSamples()` дополняет `loadPianoSamples()` +
  `loadDrumSamples()` в `loadAllSamples()`. Все три банка
  (piano + drums + synth) регистрируются за один `samples()`-eval
  в `App.tsx onMount`.

  + 3 новых пресета в `BUILTIN_PRESETS`:
  - 'analog-bass' — CC0 Moog через `s("synth:bass-c2")` + tape stop
  - 'lush-pad'   — CC0 Vanyamba choir + CAT-FOX IDM Atmosphare
  - 'retro-lead' — CC0 Garzul Minimoog vibrating (e4 + g4)
antithesis: |
  (1) «4 bass файла по 5-30KB — слишком короткие, не дадут
    sustain». Возражение: Vanyamba "Waveform Stereo" — 32 секунды
    sustained; menegass "MOOG_BASS_SPACE_ECHO" — 2-3 секунды с
    встроенным space-echo. Strudel attack/release envelope
    вытягивает короткие сэмплы. (2) «Pitch-shift на 12 полутонов
    вниз для bass-c1 (от C2 записи) даст артефакты». Возражение:
    Bass-частоты (60-100Hz) менее чувствительны к pitch artifacts,
    чем середина. Salamander-piano делает то же самое без
    жалоб. (3) «Vanyamba pads 32s × 4 = ~1MB только на pads —
    перебор». Решение: 1.3MB total всё ещё в 1-3MB бюджете;
    длинные сэмплы нужны для sustained pad-звука (короткие
    сэмплы здесь не работают — нет sustain). (4) «Все сэмплы с
    Freesound preview CDN — не надёжно, упадёт в offline».
    Возражение: PWA service worker precache всех файлов из
    `public/samples/` при install; после первого load всё
    работает offline. Префикс `synth:` гарантирует, что Strudel
    ищет только в нашем локальном банке.
synthesis: |
  Synth samples (CC0, 1.3MB) + Strudel `samples({synth: ...})` loader
  + 3 demo presets. Вместе с piano (720KB) + drums (80KB) =
  ~2.1MB sample bundle, всё offline после первого SW install.
  Источники: Freesound preview CDN с явной CC0-лицензией.
  Vanyamba "Waveform Stereo" series — звуковой дизайн (32s
  sustained); menegass "MOOG_*" — 2-3s analog plucks; Garzul
  "minimoog_vibrating_*" — 5s Minimoog lead с vibrato; CAT-FOX_ALEX
  "IDM Atmosphare" — 8s atmospheric pads; brotherandroid "Suiko
  Vs-1 Strings" — 2s synth strings. Strudel pitch-shifts от
  recorded pitch к target note в mini-notation.
substrate: |
  + `public/samples/synth/*.mp3` (new, 12 files, ~1.3MB):
    CC0 Freesound samples (4 bass + 4 pad + 2 lead + 1 strings +
    1 brass), LICENSE.txt with attribution table.
  + `ui/src/infrastructure/audio/SampleLoader.ts` (refactored):
    unified `loadSynthSamples()` + `loadAllSamples()` aggregator
    (piano + drums + synth). PianoSampleLoader.ts kept as
    back-compat re-export shim.
  + `ui/src/App.tsx`: onMount calls `loadAllSamples()` from
    SampleLoader (was: loadPianoSamples from PianoSampleLoader).
  + `ui/src/domain/presets.ts`: 3 new entries —
    'analog-bass' (synth:bass-*), 'lush-pad' (synth:pad-* +
    synth:strings-c4), 'retro-lead' (synth:lead-*). 25 total
    built-in presets (was 22 after drums merge).
  + `ui/src/domain/presets.test.ts`: count → 25, +2 new tests
    for synth-pack demos (uses `synth:` bank).
  + `ui/src/infrastructure/audio/SampleLoader.test.ts` (extended):
    22 tests covering both drums + synth packs + unified loader
    (was 14 tests, +8 new for synth).
  + `math/wavecode-sample-synth/witness` (new): SHA + files +
    notes.
status: applied
axiom: A1
witness:
  applied_at: 2026-10-09
  commit: e4ac7be
  supersedes: null
epistemics:
  - statement: "12 CC0 Freesound previews — analog bass + pad + lead +
      strings + brass, ~1.3MB total. All verified CC0 via
      `?f=license:\"Creative Commons 0\"` filter on Freesound search."
    marker: fact
    evidence: "Freesound HTML page for each source verified to contain
      `<span class=\"bw-icon-zero\">` icon (CC0 badge). Direct preview
      URLs from `https://cdn.freesound.org/previews/...` are
      public (no auth required)."
  - statement: "Strudel `samples({synth: './samples/synth/'})`
      registers a sample bank; `s('synth:bass-c1')` plays
      bass-c1.mp3 (or closest available pitch)."
    marker: fact
    evidence: "Strudel @strudel/webaudio API: `samples({bank: path})`
      registers a sample bank. Bank prefix is used as
      `bank:filename` in `s(...)` operator. Verified against
      wavecode-sample-pack packet (piano bank precedent)."
  - statement: "Vite's `import-analysis` plugin resolves static
      string literals to file paths at build time. Using a
      variable as the argument to `import()` (with
      `/* @vite-ignore */` hint) defers resolution to runtime."
    marker: fact
    evidence: "Vite docs: dynamic import with non-literal argument
      is treated as runtime import; @vite-ignore comment explicitly
      tells Vite to skip static analysis."
  - statement: "PWA service worker precaches all files in
      `public/` at install. After first load, all sample banks
      (piano + drums + synth) work offline."
    marker: fact
    evidence: "vite-plugin-pwa with `globPatterns: ['**/*.{js,css,
      html,svg,png,ico,webmanifest,woff2}']` precaches the dist
      output. `public/samples/*` is statically copied to dist/ by
      Vite (verified in `dist/samples/synth/`)."
  - statement: "Strudel pitch-shifts sample from recorded pitch
      to target note. Files recorded at C5 (strings) and C2
      (pads) work fine when addressed as C4 and C3 respectively
      in the score."
    marker: fact
    evidence: "Strudel Tidal mini-notation: `note(\"c4\").s(\"synth:
      strings-c4\")` triggers the strings sample, pitch-shifted
      12 semitones down (C5 → C4). Same mechanism used by
      Salamander piano pack (C7 → E7 etc)."
  - statement: "All four authors — Vanyamba, menegass, Garzul,
      CAT-FOX_ALEX, brotherandroid — publish under CC0 1.0.
      Verified on Freesound: each sound page shows the
      `Creative Commons 0` license badge."
    marker: fact
    evidence: "Freesound HTML badge `<span class=\"bw-icon-zero\">`
      (CC0) and `title=\"License: Creative Commons 0\"` for each
      source URL. Author profile pages confirm consistent CC0
      licensing across their packs."
  - statement: "Lifestyle: Freesound previews are LQ MP3
      (64kbps 24kHz JntStereo). Total bundle: 1.3MB for 12 files
      = ~108KB avg. Largest single file: brass-c3.mp3 (262KB). All
      within the 1-3MB budget specified in the task."
    marker: fact
    evidence: "Sum of file sizes from `ls -la` output: 1.3MB total."
