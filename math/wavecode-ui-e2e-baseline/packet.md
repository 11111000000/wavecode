---
proposition: |
  E2E verification suite + Lighthouse baseline: 5 playwright
  сценариев покрывают все user-visible баги после T1-T5 +
  perf budget + a11y axe-core. Финальный gate перед merge
  в master.
outcome: |
  `tests/e2e/ui-overhaul.spec.ts` — 5 passing сценариев.
  `tests/e2e/lighthouse.spec.ts` — perf/a11y/bp baseline
  записан. Все ручные smoke-проверки на mobile + desktop
  прошли. Final merge в master.
test: |
  playwright e2e (5 сценариев):
  1. @ 412×900 → Piano chip → sheet full → 24 кнопки piano
     в DOM, 14 whites + 10 blacks, чёрные в z-order 2 поверх
     белых. Click 'note(' → CodeMirror doc содержит 'note('.
  2. @ 412×900 → любой BottomSheet открыт → MiniNotationToolbar
     виден (не уходит за cm-host).
  3. @ 1440×900 → AI-panel height ≥60vh, score-panel width
     = 360px (drawer). Toggle → flip за 240ms.
  4. axe-core @ 1440×900 + @ 412×900 → 0 critical/serious.
  5. Sample loading pill виден при первом click, исчезает
     после загрузки.

  Lighthouse (3 baseline):
  - perf ≥90 @ desktop + mobile.
  - a11y ≥95 @ desktop + mobile.
  - bp ≥85 @ desktop.

  Записать baseline в `ui/.lighthouse/baseline.json` для drift.
invariant: |
  - `tests/e2e/ui-overhaul.spec.ts` committed.
  - `ui/.lighthouse/baseline.json` committed (initial values).
  - `tests/e2e/lighthouse.spec.ts` падает при регрессии >5%.
antithesis: |
  (1) «E2E тесты = slow CI». Возражение: тесты параллельны
    через playwright.config workers=2; total <2 min.
  (2) «Lighthouse в CI — flaky». Возражение: lighthouse-ci
    server имеет variance <3% baseline; мы сравниваем с
    baseline.json, не с абсолютом.
synthesis: |
  3 файла:

  1. `tests/e2e/ui-overhaul.spec.ts` — 5 сценариев через
     `playwright/test`. Использовать `shared_browser_*` если
     доступны, иначе `mcp__playwright__*` (per browser skill).
  2. `tests/e2e/lighthouse.spec.ts` — programmatic lighthouse
     через `lighthouse` npm + node-api, compare с
     `ui/.lighthouse/baseline.json`.
  3. `ui/.lighthouse/baseline.json` — initial values для
     drift detection.

  Manual smoke: dev server, проверка @ localhost:5173 на
  оба viewport, click through основные flows (Piano, Step,
  AI submit, preset switch).
status: draft
supersession-of: math/wavecode-ui-design-overhaul/packet.md
axiom: A1
---

## Substrate

- `tests/e2e/ui-overhaul.spec.ts` (new).
- `tests/e2e/lighthouse.spec.ts` (new).
- `ui/.lighthouse/baseline.json` (new).
- `playwright.config.ts` (extend): add workers, project setup.

## Verification

```bash
cd tests
npx playwright test ui-overhaul.spec.ts
npx playwright test lighthouse.spec.ts
```

Manual smoke: dev server @ localhost:5173, smoke 3-4 основных
flow-а.

## Final step

После прохождения всех проверок — merge ветки T6 в master,
удалить worktree, архивировать packet (witness файл).