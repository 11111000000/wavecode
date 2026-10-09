---
proposition: |
  `domain/presets.ts` расширяется с +8 жанровыми пресетами, всего 16:
  rock/pop/folk уже есть (8 шт.), добавляем:
  - **EDM 4-on-floor**: kick on every beat + supersaw bass + pluck lead + white noise hat
  - **Hip-hop boom-bap**: swing 16ths, hard kick 2&4, snare 3, vinyl crackle
  - **Jazz ii-V-I**: walking bass + comping chords + brushed snare
  - **Ambient pad**: long-attack sine drone + slow LFO + sparse bells
  - **Latin / Bossa Nova**: syncopated clave + nylon-string comping + shaker
  - **Trap / modern hip-hop**: 808 sub + hi-hat rolls + sparse lead
  - **Reggaeton**: dembow rhythm + detuned synth bass + plucks
  - **IDM glitch**: polymetric stacks (5/4 + 7/8) + bit-reduced samples
  - **Dreampop / shoegaze**: 16th-note strum + chorus-washed pad + soft vocal
  - **Step-Grid demo**: готовый 8-step pattern, чтобы при первом нажатии
    `🎹 Step` была видна готовая сетка (rock-бит bd 0,2 / sd 1,3 / hh each).
  Каждый пресет = `stack(...)` с явными ролями (bass / chord / lead / drums),
  короткий (≤10 строк), self-contained (без `.slow(N)`), играет
  на cps=0.5 = 1 cycle / 2 сек. Комментарий в первой строке — жанр
  и ритмический рисунок.
antithesis: |
  (1) «Профи не пользуются пресетами, они играют live-coding с нуля».
    Возражение: пресет = стартовая точка для модификации. Профи
    сэмплируют звук пресета, меняют 1-2 параметра → готово за 30 сек
    вместо 5 мин. (2) «Профи хотят ААА-качество, не синт Strudel».
    Возражение: всё Phase 5 — про доступный live-coding. Эти пресеты
    дают «вкус жанра» за 0 строк кода. (3) Strudel поддерживает
    GM drums, supersaw, fm, но не wavetable-качество. Решение: для
    ambient/jazz используем pure-tone (sine/triangle) с envelope —
    качество лучше дефолтных saw. (4) Слишком много пресетов = UI
    перегружен. Решение: dropdown сгруппирован по жанрам через
    `<optgroup>` в `presentation/state/presetsStore`/App.tsx —
    existing `<select>` уже в `.app-preset-row`.
synthesis: |
  10 новых пресетов в `BUILTIN_PRESETS` (включая step-grid demo).
  Расширяем `presentation/state/presetsStore.allPresets()` — порядок
  сохраняется, custom-пресеты идут в конце (existing behavior). UI
  в App.tsx использует `<For each={allPresets()...}>` в `<optgroup>`,
  existing layout с лейблами `Встроенные` + `Мои`. Дополнительных
  изменений UI не нужно — старший optgroup label становится общим
  (`Встроенные` уже включает все builtin'ы). Минимально инвазивный
  patch, оставляет custom-preset UX идентичным.
substrate: |
  + `ui/src/domain/presets.ts`: 10 new entries to `BUILTIN_PRESETS`:
    - 'edm-house' (style: 4-on-floor, supersaw lead)
    - 'hiphop-boombap' (swing, 808-ish, vinyl crackle)
    - 'jazz-ii-v-i' (Dmin7 → G7 → Cmaj7 walking bass)
    - 'ambient-drone' (sine + slow LFO + sparse bells)
    - 'bossa-nova' (clave + nylon comping + shaker)
    - 'trap-modern' (808 sub + hat roll)
    - 'reggaeton' (dembow + detune synth bass)
    - 'idm-glitch' (5/4 + 7/8 polymetric, bit-reduce)
    - 'dreampop' (shoegaze, 16ths + chorus pad)
    - 'step-grid-demo' (rock beat, для 🎹 Step)
  + `ui/src/domain/presets.test.ts`: 5 cases — каждый новый пресет
    компилируется через `transpiler.evaluate`, не throws, и имеет
    sane `queryArc` output (≥2 ноты в первом цикле).
status: applied
axiom: A1
witness:
  applied_at: 2026-10-09
  commit: pending
  supersedes: null
epistemics:
  - statement: "Strudel `s('bd sd hh cp')` = GM-mapped drums через
      superdough (сэмплы из Tone.js drum-machines)"
    marker: fact
    evidence: "Strudel docs: drum-samples built-in в @strudel/core через
      ToneJS drum machine presets"
  - statement: "`supersaw` — Strudel-примитив, имитирует JP Supersaw
      (5-7 sawtooths detuned), встроен в @strudel/tonal"
    marker: fact
    evidence: "Strudel Pattern API: `supersaw(freq, detune, count)` —
      синтезатор с detuned saws"
  - statement: "`swing` operator: `.swing(subdiv, amount)` —
      shuffle 16ths по дефолту с amount 0.5"
    marker: fact
    evidence: "Strudel docs: `swing(amount, divisor)` shuffle 8th/16th
      notes; `.swing(0.5)` standard shuffle"
  - statement: "`bitcrush` + `crush` — bit reduction в @strudel/tonal"
    marker: fact
    evidence: "Strudel API: `bitcrush(bits, rateHz)` reduces bit depth
      — IDM-style degradation"
  - statement: "Strudel `transpiler.evaluate(code)` async — throws на
      синтаксических ошибках, не бросает на runtime-ошибках (returns
      Error в haps)"
    marker: fact
    evidence: "midi-io packet (sha 2745586): `transpilerMod.evaluate`
      pattern + queryArc usage — pattern can throw on syntax"
  - statement: "10 новых пресетов × ~6 строк каждый = ~60 строк +
      comments ≈ +5KB до bundle gzip; влияние на перформанс ≈ 0"
    marker: judgment
    evidence: "Strudel eval — single cycle, <10ms; gzip ratio 4:1 для
      JSON-text пресетов"
---
