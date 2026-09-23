---
proposition: |
  wavecode — чистофронтовый браузерный SPA для live-coding музыки с
  AI-агентом; не имеет серверных компонентов и не зависит от
  ~/Projects/Composer/.
antithesis: |
  Чистофронтовый SPA теряет доступ к профессиональной Tidal+SuperDirt
  инфраструктуре (SC-UGen'ы, Dirt-Samples, Icecast-стрим публичным
  слушателям, persistent-режим когда браузер закрыт). Strudel в браузере
  менее зрелый, чем полный Tidal+SuperDirt. Если use case требует
  публичного стрима или профессионального звука — нужен backend,
  pure-frontend недостаточно.
synthesis: |
  Use case оператора — local live-coding в браузере, я сам себе
  слушатель. Strudel+Web Audio покрывает 80% паттернов и синтеза.
  Если позже понадобится backend (Icecast-стрим, SC-UGen'ы) — это
  отдельный сервис, не Composer; пишется параллельно. Composer
  остаётся backend-проектом в другом треде разработки и не
  интегрируется с wavecode.
substrate: none
status: draft
axiom: A3
epistemics:
  - statement: "wavecode и Composer — разные проекты, без зависимости"
    marker: judgment
    evidence: "operator-directive 2026-09-23 в opencode-сессии"
  - statement: "use case — local live-coding в браузере, без публичного стрима"
    marker: judgment
    evidence: "operator-directive 2026-09-23"
---

## Intent

Wavecode — самостоятельный frontend-проект. Деплоится как SPA
(статические файлы) на любой host. Никаких Nix-выходов, никаких
контейнеров, никаких серверных процессов.

## What this is NOT

- Не интегрируется с `~/Projects/Composer/`. Composer — отдельный
  backend-проект.
- Не имеет Nix-флейка с nixosConfigurations / packages / apps. Dev — через
  `pnpm dev`, build — через `pnpm build`.
- Не требует SuperDirt / Tidal / sclang / ghci. Только Strudel в Web Worker.
- Не имеет gateway / WebSocket-сервера. Audio rendering — в браузере.

## Worked example

```
 ~/Projects/wavecode/                   ~/Projects/Composer/
 ├── ui/ (SPA)                          ├── modules/composer.nix
 │   ├── src/infrastructure/            ├── packages/tidal.nix
 │   │   ├── llm/                       └── ...  (server-side Tidal+SuperDirt+Icecast)
 │   │   └── audio/ (Strudel+Tone.js)        ↕
 │   └── ...                          НЕТ связи
 ├── math/                              (отдельные треды разработки)
 │   └── wavecode-scope/packet.md
 ├── README.md
 ├── AGENTS.md
 └── .gitignore
```

`ui/src/infrastructure/audio/StrudelEngine.ts` (псевдо):
```ts
import { evalScope, repl } from '@strudel/core';
import { webaudio } from '@strudel/webaudio';

export const StrudelEngineLive = Layer.succeed(
  StrudelEngine,
  {
    eval: (snippet: string) => Effect.gen(function* () {
      yield* Effect.promise(() => evalScope(snippet, webaudio));
      // → звук идёт через Web Audio в колонки
    }),
    subscribe: (cb) => /* ... */
  }
);
```

## Notes

- Решение supersedes предыдущую формулировку ("wavecode для web-агента
  поверх Composer"), которая подразумевала интеграцию с Composer.
- Stale worktree `~/Projects/Composer/.git/worktrees/composer-ui`
  (branch `feat/composer-ui`, commit `86e7207`) содержит старую версию
  архитектурного дизайна (с gateway, Nix flake, server-side Tidal).
  Не мёрджим и не удаляем — reference для истории решений.
- Если в будущем понадобится backend — пишется как новый
  репозиторий/пакет, не интеграция с Composer.