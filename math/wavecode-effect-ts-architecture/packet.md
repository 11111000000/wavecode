---
proposition: |
  Архитектурный рантайм wavecode — Effect-TS (3.x) с 4 слоями (domain,
  application, infrastructure, presentation) и Dependency Injection через
  Effect-Layer; domain-слой — чистые функции без побочных эффектов.
antithesis: |
  Effect-TS — лишний слой абстракции для проекта, который мог бы быть
  проще на vanilla TypeScript или Zustand+React. Кривая обучения
  крутая (Effect.gen, Layer, Service), bundle size +50 KB. Для
  небольшого SPA с одним пользователем это избыточно.
synthesis: |
  Live-coding с AI-агентом имеет сложный flow: LLM-стрим по чанкам +
  tool calling + async Strudel eval + IndexedDB persistence + concurrent
  user edits. Effect-TS даёт: (1) типизированные ошибки через error
  channel, (2) structured concurrency (Stream/fork), (3) Layer-DI для
  тестируемости (mock LLMClient/AudioEngine в unit-тестах), (4)
  Schedules/Clock для дебаунса autosave, (5) разделение domain (чистые
  функции, тестируются без моков) от effects (типизированные на границе).
  Цена: +50 KB bundle, кривая обучения для новых разработчиков.
substrate: none
status: draft
axiom: A3
epistemics:
  - statement: "Effect-TS как FP-runtime даёт типизированные эффекты и DI"
  - statement: "Для live-coding с AI-агентом эффекты сложные: LLM-стрим, tool calling, async audio eval"
    marker: judgment
    evidence: "ARCHITECTURE.md §3 agent loop"
  - statement: "+50 KB bundle size — приемлемо для SPA без мобильного приоритета"
    marker: judgment
---

## Intent

Все внешние вызовы (LLM, Strudel, IndexedDB) — типизированные Effect.
Domain — pure, testable без моков. Infrastructure — реализация через
Layer.

## What this is NOT

- Не использует MobX/Zustand/Redux для domain-state. Только для UI-state.
- Не пишет напрямую fetch/eval/localStorage в application/presentation.
- Не смешивает domain с infrastructure. ESLint no-restricted-paths запрещает.

## Worked example

```ts
// domain/tools/editScore.ts — pure, без Effect
export const applyEdit = (score: Score, edit: ScoreEdit): Score => {
  const idx = score.indexOf(edit.oldText);
  if (idx === -1) throw new Error('oldText not found');
  return score.replace(idx, edit.oldText.length, edit.newText);
};

// application/editScore.ts — orchestrator через Effect
import { Effect } from 'effect';

export const editScore = (edit: ScoreEdit): Effect.Effect<Score, never, Repo | AudioEngine> =>
  Effect.gen(function* () {
    const repo = yield* Repo;
    const audio = yield* AudioEngine;
    const current = yield* repo.loadScore();
    const next = applyEdit(current, edit);  // pure call
    yield* repo.saveScore(next);
    yield* audio.eval(snippetFromScore(next));
    return next;
  });

// infrastructure/audio/LiveAudioEngine.ts — реализация
export const LiveAudioEngine: Layer.Layer<AudioEngine, never, never> =
  Layer.succeed(AudioEngine, {
    eval: (snippet) => Effect.tryPromise(() => workerEval(snippet)),
  });
```

## Notes

- Версии Effect-TS: `effect@^3.10.0`, `@effect/schema@^0.75.0`,
  `@effect/platform@^0.72.0`, `@effect/platform-browser@^0.45.0`
  (версии требуют сверки при npm install — peer-dep constraints).
- Альтернативы рассмотрены: fp-ts (более низкоуровневый), Zustand-only
  (не даёт типизированных эффектов), native async/await (ad-hoc,
  не композируется).
- 4 слоя: domain → application → infrastructure → presentation.
  ESLint запрещает cross-imports.