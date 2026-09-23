---
proposition: |
  Аудио в wavecode рендерится в браузере через @strudel/core + @strudel/webaudio,
  без серверного TidalCycles+SuperDirt+Icecast и без интеграции с ~/Projects/Composer/.
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
status: draft
axiom: A3
epistemics:
  - statement: "Strudel в браузере покрывает 80% Tidal-паттернов"
  - statement: "Web Audio latency 5-15ms vs server-side 30-80ms"
  - statement: "use case — local live-coding, без публичного стрима"
    marker: judgment
    evidence: "оператор 2026-09-23 в opencode-сессии"
---

## Intent

Score-файл — JS-код со Strudel mini-notation. Strudel runtime в Web Worker
пересчитывает паттерны; Tone.js подаёт звук через Web Audio API.

## What this is NOT

- Не TidalCycles (Haskell DSL). Strudel — JS-порт, тот же mini-notation.
- Не SuperDirt / SuperCollider / sclang / scsynth. Только Web Audio в браузере.
- Не использует Dirt-Samples. Только встроенные сэмплы Strudel + загружаемые пользователем.
- Не стримит через Icecast. Локальный звук через колонки.

## Worked example

```js
// score.js
import { s, stack, sometimes, fast, rev, n } from '~/infrastructure/audio/strudelRuntime';

export const score = `
stack(
  s("bd*4"),
  s("~ sd"),
  s("hh*8").fast(2),
  n("0 2 4 7").s("piano").sometimes(rev)
).play();
`;
```

Worker создаёт AudioContext, Tone.js подключает эффекты:
```ts
// infrastructure/audio/strudel.worker.ts
import { evalScope, repl } from '@strudel/core';
import { webaudio } from '@strudel/webaudio';
import { Tone } from '@strudel/webaudio';

self.onmessage = async (e) => {
  if (e.data.type === 'eval') {
    try {
      await evalScope(e.data.snippet, webaudio);
      self.postMessage({ type: 'eval-result', ok: true });
    } catch (err) {
      self.postMessage({ type: 'eval-result', ok: false, error: String(err) });
    }
  }
};
```

## Notes

- Strudel mini-notation — почти полный порт Tidal: `<bd sd hh>`, `[bd sd]`,
  `*`, `~`, `:`, `,`, `@` и т.д. CodeMirror extension рендерит это с
  подсветкой.
- Tone.js используется для эффектов-цепи (reverb/delay/filter), не для
  синтеза (Strudel синтезирует сам через Web Audio).
- Если в будущем понадобится professional audio — пишется отдельный
  backend-сервис (не интеграция с Composer).
- Зависимости: `@strudel/core`, `@strudel/webaudio`, `@strudel/mini-notation`,
  `@strudel/tonal`, `@strudel/transpiler`, `@strudel/serialism`, `tone`.