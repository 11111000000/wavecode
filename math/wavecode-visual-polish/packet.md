---
proposition: |
  Visual polish pass wavecode: empty/loading states (ScorePanel
  empty + audio loading skeleton), focus rings (глобальный
  cyan-glow на всех focusable), touch targets 44×44 (wc-icon-btn,
  wc-chip, mini-toolbar-btn), micro-interactions (press-shrink
  0.95ms spring на :active), контраст-проверка через axe-core.
outcome: |
  Lighthouse a11y ≥95. axe-core 0 critical/serious violations.
  Score пустой → on-screen guide (3 подсказки: chip Piano,
  ИИ, готовые пресеты). Audio suspended → skeleton-pulse 1-2s.
  Все кнопки ≥44×44 hit area. Focus-visible cyan-glow.
  Press-shrink ощутим на всех кнопках.
invariant: |
  - `.score-empty-state` виден когда `appStore.score.trim()
    === ''`, скрыт иначе.
  - `.audio-loading-skeleton` виден при `ctxState.state ===
    'suspended'` и audio player недавно стартовал (<2s).
  - `:focus-visible { outline: 2px solid var(--cyan); outline-
    offset: 2px; box-shadow: var(--shadow-glow-cyan) }` —
    глобально в base.css, исключая `.cm-editor` (свой ring).
  - `.wc-icon-btn, .wc-chip, .mini-toolbar-btn { min-width:
    44px; min-height: 44px }`.
  - `:active { transform: scale(0.95); transition: transform
    var(--dur-xs) var(--ease-spring) }` для интерактивных.
test: |
  - playwright e2e: clear IDB → reload → empty state виден.
  - playwright e2e: axe-core @ 1440×900 + @ 412×900 →
    0 critical/serious.
  - vitest: snapshot TopBar — focus ring на wc-icon-btn при
    keyboard focus.
  - lighthouse-ci: a11y ≥95 @ desktop + mobile.
antithesis: |
  (1) «Press-shrink мешает accessibility — double-tap zoom».
    Возражение: shrink = scale transform, НЕ zoom. Не влияет
    на iOS double-tap-to-zoom (который контролируется viewport
    meta + touch-action).
  (2) «axe-core — слишком строгий, false positives». Возражение:
    тестируем только critical/serious (не moderate/minor).
    Moderate можно отложить.
  (3) «44px touch target — портит desktop look». Возражение:
    desktop hit area может быть больше visual size; padding
    решает без увеличения visual.
synthesis: |
  5 файлов:

  1. `ui/src/presentation/panels/ScorePanel.tsx` — добавить
     `<Show when={appStore.score.trim() === ''}>
       <div class="score-empty-state">...</div>
     </Show>` над `<CodeMirrorEditor>`.
  2. `ui/src/styles/components.css` — `.score-empty-state`
     стили (3 строки текста + 3 chip-icon подсказки, padding
     var(--space-2xl), color: var(--fg-dim)).
  3. `ui/src/styles/base.css` — глобальный `:focus-visible`
     rule (исключая `.cm-editor`).
  4. `ui/src/styles/components.css` — touch-target + press-shrink:
     ```css
     .wc-icon-btn, .wc-chip, .mini-toolbar-btn,
     .ctrl-btn, .ai-apply-btn {
       min-width: 44px; min-height: 44px;
     }
     button:not(.no-shrink):active {
       transform: scale(0.95);
       transition: transform var(--dur-xs) var(--ease-spring);
     }
     ```
  5. `ui/src/styles/components.css` — `.audio-loading-skeleton`
     shimmer-pulse.
  6. `ui/src/App.tsx` — `Show when={ctxState().state ===
     'suspended' && audio recently started}` → render skeleton.
status: draft
supersession-of: math/wavecode-ui-design-overhaul/packet.md
axiom: A1
---

## Substrate

- `ui/src/presentation/panels/ScorePanel.tsx` (extend): empty state.
- `ui/src/styles/components.css` (extend): .score-empty-state +
  touch-target + press-shrink + .audio-loading-skeleton.
- `ui/src/styles/base.css` (extend): global :focus-visible.
- `ui/src/App.tsx` (extend): audio loading skeleton visibility.

## Verification

```bash
cd ui
npx vitest run
npm run build
# playwright e2e (T6 spec)
```

Manual: lighthouse @ 1440×900 + 412×900 → a11y ≥95. axe-core
0 critical.