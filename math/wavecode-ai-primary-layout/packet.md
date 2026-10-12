---
proposition: |
  AI-primary layout wavecode: на desktop (≥1024px) AI-чат занимает
  доминирующую площадь viewport (≥60% высоты, ≥320px min),
  ScorePanel уходит в 360px collapsed drawer справа. На mobile —
  без изменений (BottomSheet-ы уже инвертированы: Score виден по
  умолчанию, AI по табу). Toggle в TopBar переключает
  code-primary ↔ ai-primary, persisted в localStorage.
outcome: |
  На 1440×900 viewport: AI-panel height ≥60vh, score-panel
  width = 360px (drawer справа). Toggle flip-ит layout за 240ms
  transition. На 1024×600 min-height 320px защищает от коллапса.
  На mobile (≤1023px) layout остаётся compact (Score основной,
  AI по табу), data-layout атрибут не применяется.
invariant: |
  - `data-layout="ai-primary"` на `.app-body` (≥1024px) →
    `.ai-panel { flex: 1 1 60%; min-height: 320px; min-width: 0 }`,
    `.score-panel { flex: 0 0 360px; overflow-y: auto }`.
  - `data-layout="code-primary"` (default на mobile) →
    текущая геометрия (`.score-panel { flex: 1 1 auto }`,
    `.ai-panel { max-height: 40vh }`).
  - TopBar toggle-кнопка показывает активный layout через
    `aria-pressed`, иконка LayoutSwapIcon (или два icon-варианта).
  - Persist в localStorage как `wavecode-layout-v1`:
    `'code-primary' | 'ai-primary'`.
test: |
  - vitest: uiState.test.ts — setLayout + getLayout roundtrip;
    default = mobile-detect: ≥1024 → 'ai-primary', else 'code-primary'.
  - playwright e2e: @ 1440×900 → assert `.ai-panel` height ≥60vh,
    `.score-panel` width = 360px. Toggle → assert flip за 240ms.
  - playwright e2e: @ 412×900 → assert `.score-panel` flex-1,
    AI-button visible только через таб.
antithesis: |
  (1) «AI как главный — спорно, юзер привык кода». Возражение:
    юзер сам сказал «AI должен быть на самом видном месте».
    Toggle в TopBar = reversal за 1 клик, cost ≈ 0.
  (2) «Drawer 360px — тесно для кода». Возражение: drawer = scrollable,
    код-редактор имеет свой внутренний scroll. Юзер видит свой код,
    но доминирует AI (по запросу).
  (3) «min-height 320px — magic number». Возражение: 320px = footer
    (textarea + 3 controls) + 256px messages-list минимум. Magic
    justified by content audit.
synthesis: |
  3 компонента + 1 сигнал:

  1. `uiState.layout: 'code-primary' | 'ai-primary'` (signal,
     default `'ai-primary'` если ≥1024, иначе `'code-primary'`).
     Persisted в localStorage `wavecode-layout-v1`.
  2. App.tsx: добавить `<LayoutToggleIcon />` кнопку в
     `.wc-topbar__actions` (после `PhoneIcon`). Handler:
     `setLayout(uiState.layout === 'ai-primary' ? 'code-primary' : 'ai-primary')`.
  3. App.tsx: обернуть `<div class="app-body">` в
     `<div class="app-body-wrap" data-layout={uiState().layout}>` —
     атрибут data-layout позволяет CSS реагировать на состояние.
  4. components.css: добавить блок
     `@media (min-width: 1024px) { .app-body[data-layout='ai-primary'] .ai-panel {...} .app-body[data-layout='ai-primary'] .score-panel {...} }`.
     Default (без data-layout атрибута, или code-primary) — текущая
     геометрия.

  Не трогать: FAB position, TabBar (mobile), BottomSheet routing.
  Не делать: collapse drawer в icon-only mode (потом, в T4 visual).
status: draft
supersession-of: math/wavecode-ui-design-overhaul/packet.md
axiom: A1
---

## Substrate

- `ui/src/presentation/state/uiState.ts` (modify): add
  `layout: 'code-primary' | 'ai-primary'` field to UIState,
  `getLayout()`, `setLayout(layout)` functions, localStorage
  persistence `wavecode-layout-v1`.
- `ui/src/presentation/icons.tsx` (add): `LayoutSwapIcon`
  component (20px, two stacked rectangles, one above other).
- `ui/src/App.tsx` (modify): import setLayout + LayoutSwapIcon,
  add toggle button to `.wc-topbar__actions`, wrap `.app-body` in
  div with `data-layout={uiState().layout}`.
- `ui/src/styles/components.css` (add): @media (min-width: 1024px)
  block for `.app-body[data-layout='ai-primary']`.
- `ui/src/presentation/state/uiState.test.ts` (extend): 2 tests
  on setLayout + getLayout.
- `tests/e2e/ai-primary.spec.ts` (new): playwright e2e for
  layout flip + viewport-specific behavior.

## Verification

```bash
cd ui
npx vitest run uiState.test
npm run build
npx playwright test tests/e2e/ai-primary.spec.ts
```

Manual @ 1440×900: AI ≥60vh, Score drawer 360px справа. Toggle
→ flip за 240ms.

Manual @ 412×900: layout = code-primary (default mobile),
ai-panel max-height 40vh.