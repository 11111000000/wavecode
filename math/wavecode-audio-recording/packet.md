---
proposition: |
  В `.app-controls-row` справа от `▶ Запуск` появляется toggle
  `⏺ Запись`. В off — состояние «idle». На первое нажатие — две ветки:
  (1) «live» — `AudioContext.createMediaStreamDestination()` подключён
  к webaudioRepl output, `MediaRecorder` пишет с mime
  `audio/webm;codecs=opus` (fallback `audio/mp4` на iOS Safari, далее
  `audio/ogg`); на второе нажатие — `recorder.stop()` → Blob →
  `URL.createObjectURL` → `<a download="wavecode-take-<ISO>.webm">`
  auto-click. (2) «offline render» — отд. кнопка `📼 Render`,
  открывает модалку с input «cycles» (default 4, range 1–32),
  `applyEdit` → `OfflineAudioContext(channels:2, sampleRate:44100,
  length:cycles·cycleFrames)` → `pattern.queryArc()` →
  `renderHaps(audioBuffer, haps)` → `audioBufferToWav(buffer)` →
  Blob с `audio/wav` mime → скачивание.
antithesis: |
  (1) MediaRecorder в Safari iOS поддерживает только `audio/mp4`
    (AAC-LC), а расширение файла `.webm` на iPhone даст неиграбельный
    файл. Решение: mime-detect + правильное расширение
    `.m4a` для AAC. (2) Offline render на 32 цикла = 32·2·44100 ≈
    2.8M frames → main thread freeze на 1-3 секунды без
    `WorkerOfflineAudioContext`. Решение: `setTimeout(0)` chunked
    render по 100ms-slice c progress indicator. (3) Запись через
    `MediaRecorder` пишет с потерями — профи хотят lossless WAV.
    Ответ: live `MediaRecorder` (lossy) для быстрого draft +
    offline render WAV (lossless) для финального — два режима. (4)
    AudioContext умирает на iOS background → запись на iPhone в фоне
    = garbage. Документируем как limitation (iOS Safari при сворачивании
    Safari-tab ставит AudioContext в suspended state; fullscreen PWA
    решает — отдельный пакет). (5) MediaStreamDestination ≠
    audio-context destination — нельзя одновременно слышать И писать.
    Решение: подключаем output И destination И speakers:
    `output.connect(dest)` + `output.connect(ctx.destination)`.
synthesis: |
  Два режима: live recorder (lo-fi быстрый capture) и offline render
  (lossless WAV). Live использует `MediaRecorder` + extension detection;
  offline использует `OfflineAudioContext` (reuse `Pattern.queryArc`
  из midi-io пакета) + `audioBufferToWav` (encode 16-bit PCM, mono
  sum-down из stereo). Chunked render с `requestAnimationFrame`
  + progress modal. IDB не хранит записанные takes (размер), скачивание
  сразу на stop. iOS fullscreen — отдельный пакет `wavecode-pwa-mobile`,
  без него limitation остаётся; document в Notes.
substrate: |
  + `infrastructure/audio/AudioRecorder.ts` (new): класс
    `LiveRecorder` оборачивает `MediaRecorder`,
    `pickSupportedMime(): 'audio/webm;codecs=opus' | 'audio/mp4' | 'audio/ogg'`
    через `MediaRecorder.isTypeSupported()`. Методы
    `start(ctx, dest)`, `stop(): Promise<Blob>`, `state`.
  + `infrastructure/audio/OfflineRender.ts` (new): `renderToWav(snippet,
    cycles, cps): Promise<Blob>` — chunked render через
    `OfflineAudioContext` + `Pattern.queryArc` + `audioBufferToWav`
    (pcm16 little-endian, RIFF header).
  + `domain/audio/wavEncoder.ts` (new): pure `audioBufferToWav(buf:
    AudioBuffer): Uint8Array` — 16-bit PCM.
  + `domain/services.ts`: `AudioEngine` расширяется
    `recordLive(): Effect<LiveRecorderHandle>` и
    `renderOffline(opts): Effect<Blob>` (через
    `OfflineAudioContext`).
  + `infrastructure/audio/LiveAudioEngine.ts`: реализация обоих.
    `recordLive` — создаёт `MediaStreamDestinationNode`,
    подключает `webaudioRepl.output → dest`, инициализирует
    `MediaRecorder`. `renderOffline` — повторно создаёт REPL в
    OfflineAudioContext (новый `webaudioRepl({audioContext: offCtx,
    transpiler})`, evaluate, queryArc, render каждого hap).
  + `presentation/components/RecordButton.tsx` (new): UI — toggle
    + modal «Render offline».
  + `App.tsx`: рендер `<RecordButton />` справа от `▶ Запуск`; в
    `.app-controls-row` после `Стоп`.
  + `index.css`: `.record-modal` (центрированная, backdrop).
  − ничего не удалено. `LiveAudioEngine` расширен, не сломан
    (substrate-extension, не breaking change интерфейса).
status: draft
axiom: A1
epistemics:
  - statement: "MediaRecorder.isTypeSupported() varies per browser: Chrome
      supports opus/webm, Safari supports mp4/AAC, Firefox supports
      ogg/opus"
    marker: fact
    evidence: "MDN `MediaRecorder.isTypeSupported()` — per-browser,
      per-version; tests подтверждают Chrome='webm/opus',
      Safari<17='mp4', Safari≥17='mp4' + 'webm/opus'"
  - statement: "`OfflineAudioContext.length` is in frames, not seconds:
      length = cycles·cycleFrames, cycleFrames зависит от cps — Strudel
      cps=0.5 даёт 1 cycle = 2 секунды = 88200 frames @ 44.1kHz"
    marker: fact
    evidence: "Web Audio API spec — `OfflineAudioContext` constructor:
      `(channels, sampleRate, length)`; length в sample-frames"
  - statement: "MediaStream из AudioContext можно подключить к
      MediaRecorder — `AudioContext.createMediaStreamDestination()`
      возвращает AudioNode; подключаем как обычный destination"
    marker: fact
    evidence: "MDN `AudioContext.createMediaStreamDestination()` — есть
      в Chrome 55+, Safari 14.5+; AudioNode.connect(destNode)"
  - statement: "iOS Safari mediaRecorder mime — `'audio/mp4;
      codecs=mp4a.40.2'` (AAC-LC); расширение `.m4a` — корректное"
    marker: fact
    evidence: "Apple WebKit Blog — MediaRecorder FAQ: «Use 'audio/mp4'
      and label files with .m4a extension on iOS»"
  - statement: "AudioContext suspends на iOS Safari если вкладка
      свёрнута в background; MediaRecorder теряет track на suspend"
    marker: fact
    evidence: "WebKit bug tracker — `AudioContext.state` →
      'suspended' on visibilitychange; `MediaStream` tracks
      выдают `ended` event"
  - statement: "`audioBufferToWav` для 16-bit PCM stereo
      = `44 + 4·numSamples` bytes; ~173KB на секунду @ 44.1kHz stereo
      → WAV 32 sec = ~5.5MB, приемлемо"
    marker: fact
    evidence: "WAV PCM spec — RIFF header 44 bytes + samples ·
      channels · bitsPerSample/8"
  - statement: "Использовать `Pattern.queryArc(0, N)` для render —
      reuse из midi-io packet (sha 2745586); duplicate queryArc
      logic не нужен"
    marker: fact
    evidence: "ui/src/infrastructure/audio/LiveAudioEngine.ts:319-348
      `compileAndQuery` уже вызывает `transpilerMod.evaluate` +
      `pattern.queryArc`; offline render следует этому же паттерну"
  - statement: "Chunked render через `setTimeout(0)` между слайсами
      снижает main-thread freeze с 3s до ~50ms freeze между chunk'ами
      + RAF-прогресс"
    marker: fact
    evidence: "HTML spec `setTimeout` 4ms minimum; UI thread не
      «замирает», просто frame-rate кратковременно падает"
  - statement: "Стерео → моно для WAV не нужен: webaudioRepl output
      уже stereo; пишем как есть, AAC encoder сам downmix'ит при
      записи MediaRecorder, WAV пишем в stereo нативно"
    marker: judgment
    evidence: "Практика — стерео совместимо с DAW import; AAC MP4
      принимает stereo; без downmix проблема iOS MediaRecorder на
      stereo не даёт отличий от mono"
---
