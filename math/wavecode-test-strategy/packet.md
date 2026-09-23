---
proposition: |
  Тестовая стратегия wavecode — пирамида: много unit-тестов на domain
  и application (vitest), умеренно на infrastructure (vitest с моками),
  мало e2e на критичные user-flows (playwright).
antithesis: |
  Только e2e-тесты (playwright) покрывают весь stack и не требуют моков.
  Только unit-тесты — быстрые, но не проверяют wiring. BDD (cucumber)
  — лучше для documentation, но overhead для разработки.
synthesis: |
  Domain (типы, схемы, pure-функции) тестируется без моков: parse,
  validate, applyEdit, parseToolCall — vitest, ~100 тестов, запуск
  за <1s. Application (reducer, use-cases) тестируется с TestClock
  и mock Layer: agentStep transitions, editScore flow — vitest, ~50
  тестов. Infrastructure тестируется с моками @ai-sdk и Web Worker:
  LLMClient отправляет правильный формат, AudioEngine.eval проксирует
  в Worker — vitest, ~20 тестов. Presentation (Solid-компоненты)
  тестируется через @solidjs/testing-library — минимально. E2E:
  5-10 critical flows через playwright (open editor, eval snippet,
  agent edits score, audio plays, persistence across reload).
substrate: none
status: draft
axiom: A5
epistemics:
  - statement: "Пирамида: много unit, мало e2e"
  - statement: "Domain-функции тестируются без моков (pure)"
  - statement: "Application — с TestClock и mock Layer"
    marker: judgment
---

## Intent

Тесты покрывают 4 слоя по разному:
- **domain/** — без моков, чистые функции (vitest)
- **application/** — TestClock + mock Layer (vitest)
- **infrastructure/** — моки @ai-sdk и Worker (vitest)
- **presentation/** — @solidjs/testing-library, минимум
- **e2e/** — playwright, 5-10 critical flows

Цель — 80%+ покрытие `domain` и `application`.

## What this is NOT

- Не только e2e (медленно, flaky).
- Не BDD / cucumber (overhead для разработки).
- Не snapshot-тесты на большие компоненты (brittle).

## Worked example

```ts
// domain/__tests__/applyEdit.test.ts
import { describe, it, expect } from 'vitest';
import { applyEdit } from '../tools/applyEdit';

describe('applyEdit', () => {
  it('replaces exact match', () => {
    const score = 's("bd*4");\ns("hh");';
    const next = applyEdit(score, { oldText: 's("hh");', newText: 's("sd");' });
    expect(next).toBe('s("bd*4");\ns("sd");');
  });

  it('throws if oldText not found', () => {
    expect(() => applyEdit('s("bd");', { oldText: 's("x");', newText: 's("y");' }))
      .toThrow('oldText not found');
  });
});
```

```ts
// application/__tests__/editScore.test.ts
import { describe, it, expect } from 'vitest';
import { Effect, Layer, TestClock } from 'effect';
import { editScore } from '../editScore';
import { Repo } from '~/infrastructure/repo';
import { AudioEngine } from '~/infrastructure/audio';

const TestRepo = Layer.succeed(Repo, {
  loadScore: () => Effect.succeed('s("bd");'),
  saveScore: () => Effect.void,
});

const TestAudio = Layer.succeed(AudioEngine, {
  eval: () => Effect.void,
});

describe('editScore', () => {
  it('updates score and triggers eval', async () => {
    await Effect.runPromise(
      editScore({ oldText: 's("bd");', newText: 's("sd");' })
        .pipe(Effect.provide([TestRepo, TestAudio]))
    );
    // assertions через test-doubles
  });
});
```

```ts
// e2e/agent-edits-score.spec.ts (playwright)
import { test, expect } from '@playwright/test';

test('agent edits score via chat command', async ({ page }) => {
  await page.goto('/');
  await page.locator('textarea[placeholder="Скажи что изменить..."]').fill('замени bd на sd');
  await page.locator('button:has-text("Отправить")').click();
  await expect(page.locator('.cm-content')).toContainText('s("sd")');
});
```

## Notes

- Зависимости: `vitest`, `@solidjs/testing-library`, `@playwright/test`.
- В CI: `pnpm test:run && pnpm test:e2e`. В dev: `pnpm test` (vitest watch).
- ПCoverage tracking: optional, через `vitest --coverage` (c8/v8).