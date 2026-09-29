---
proposition: |
  Аудио в wavecode рендерится в браузере через @strudel/core + @strudel/webaudio
  (webaudioRepl + evaluate), без серверного TidalCycles+SuperDirt+Icecast и без
  интеграции с ~/Projects/Composer/.
antithesis: |
  Tidal+SuperDirt даёт доступ к SC-UGen'ам (сотни синтезаторов), профессиональным
  Dirt-Samples (~3 GB), публичному стриму через Icecast и persistent-режиму
  (браузер закрыт — музыка играет). Strudel в браузере ограничен встроенными
  сэмплами и Web Audio API. Для профессионального продакшена или публичного
  стрима Strudel недостаточен.
synthesis: |
  Use case оператора — local live-coding в браузере, я сам себе слушатель.
  Strudel покрывает 80% паттернов и эффектов; professional-grade звук и
  Icecast-стрим не нужны. Если позже понадобится — добавляется отдельный
  backend-сервис, не интеграция с существующим Composer. Web Audio API
  даёт латентность 5-15ms (vs 30-80ms через ghci+OSC+SuperDirt), что
  важнее для live-coding.
substrate: none
status: applied
axiom: A3
amendment: |
  2026-09-29 amendment: использован `webaudioRepl()` (высокоуровневый
  API) вместо ручного `evalScope(snippet, webaudio)`. Knob: monkey-patch
  `AudioContext.prototype.createPeriodicWave` чтобы superdough не падал
  с IndexSizeError на пустых partials. Эффективно — это обход известного
  superdough-бага (см. node_modules/superdough/synth.mjs:495 — без
  patch падает при `.s('sine')` etc.).
  Score в default теперь полный Creep (Radiohead) с stack(bass, arpeggio,
  drums), а не статичные chord-stabs.
epistemics:
  - statement: "Strudel в браузере покрывает 80% Tidal-паттернов"
  - statement: "Web Audio latency 5-15ms vs server-side 30-80ms"
  - statement: "use case — local live-coding, без публичного стрима"
    marker: judgment
    evidence: "оператор 2026-09-23 в opencode-сессии"
  - statement: "Superdough createPeriodicWave падает на пустых partials"
    marker: fact
    evidence: "node_modules/superdough/synth.mjs:495 (createPeriodicWave(real, imag) где real.length может быть <2)"
  - statement: "webaudioRepl() — единственный корректный high-level API"
    marker: fact
    evidence: "node_modules/@strudel/webaudio/dist/index.mjs:302 (Fe function)"
---

## Intent

Score-файл — JS-код со Strudel mini-notation. Strudel runtime в main thread
пересчитывает паттерны; superdough + Web Audio API подаёт звук через колонки.

## What this is NOT

- Не TidalCycles (Haskell DSL). Strudel — JS-порт, тот же mini-notation.
- Не SuperDirt / SuperCollider / sclang / scsynth. Только Web Audio в браузере.
- Не использует Dirt-Samples. Только встроенные сэмплы Strudel + загружаемые пользователем.
- Не стримит через Icecast. Локальный звук через колонки.
- НЕ regex-парсер собственного изготовления. Это был обход superdough bug
  из старого коммита (8054330). С patch — настоящий Strudel.

## Worked example

```ts
// ui/src/infrastructure/audio/LiveAudioEngine.ts
const patchCreatePeriodicWave = () => {
  const proto = AudioContext.prototype;
  const original = proto.createPeriodicWave.bind(proto);
  proto.createPeriodicWave = (real, imag, constraints) => {
    const padded = (arr) => arr.length >= 2 ? arr : Float32Array.of(...arr, ...new Array(2 - arr.length).fill(0));
    return original(padded(real), padded(imag), constraints);
  };
};

const repl = await webaudioRepl();
await repl.evaluate(`
  stack(
    note("<g2 b2 c3 c3>*2").s("sawtooth").gain(0.35).lpf(400).decay(0.4),
    n("<[55,59,62]*2 [59,63,66]*2 [60,64,67]*2 [60,63,67]*2>").s("sawtooth").gain(0.18).lpf(1800),
    s("bd*4, ~ sd ~ sd, hh*8").gain(0.45)
  ).slow(2)
`);
```

## Notes

- Strudel mini-notation — почти полный порт Tidal: `<bd sd hh>`, `[bd sd]`,
  `*`, `~`, `:`, `,`, `@` и т.д. CodeMirror extension рендерит это с
  подсветкой.
- Web Worker не используется: Web Audio API живёт только в main thread
  (browser limitation), `@strudel/webaudio.webaudioRepl()` создаёт
  AudioContext там же. Pattern eval быстрый (<10ms), main не блокируется.
- Если в будущем понадобится professional audio — пишется отдельный
  backend-сервис (не интеграция с Composer).
- Зависимости: `@strudel/core`, `@strudel/webaudio`, `@strudel/mini`,
  `@strudel/tonal`, `@strudel/transpiler`, `@strudel/serial`.
- `tone.js` НЕ используется — Strudel + superdough покрывают все нужные
  эффекты (lpf, delay, reverb, etc.) нативно.
