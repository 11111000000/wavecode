---
proposition: |
  Performance budget wavecode: 1.4MB JS bundle (CM + strudel + effect)
  + 60KB CSS, FCP 2.5s+ на throttled 4G. Реализуем 4 fix-а:
  (a) CSS variables для piano (убирает 14 inline-style объектов),
  (b) dynamic-import CodeMirrorEditor (lazy при первом score tab),
  (c) critical CSS inline в head (первые 8KB), остальное async,
  (d) sample-loader progress indicator (UI feedback для 2.1MB
  preload). Плюс audit: EditorView dispose на ScorePanel unmount,
  createRoot dispose на HMR.
outcome: |
  Lighthouse perf ≥90 @ 1440×900 (baseline ≤80). FCP <1.5s на
  throttled 4G. Sample preload виден пользователю через progress
  pill в TopBar. CM не блокирует initial paint. Zero leaked
  EditorView при rapid scoreOpen toggle.
invariant: |
  - `.piano-keys-inner { --white-w: 80px; --black-w: 50px;
    --piano-h: 220px }` + @media (max-width: 720px) override.
    `PianoKeyboard.tsx` НЕ использует inline-style для sizing
    (только dynamic press-state).
  - `CodeMirrorEditor` загружается через `lazy(() => import('./...'))`
    или dynamic-import при первом scoreOpen.
  - Critical CSS = topbar + preset-row + tokens (≤8KB inline).
  - Sample loader progress обновляется в `uiState.sampleStatus`
    (idle | loading | ready), TopBar показывает pill.
test: |
  - vitest: PianoKeyboard.test.ts — нет inline-style для sizing
    (snapshot DOM, проверка что style="" не содержит width/height).
  - vitest: appStore.test.ts — rapid toggle scoreOpen × 50 →
    0 leaked EditorView (mock view.destroy spy).
  - lighthouse-ci: perf ≥90, FCP <1.5s @ throttled 4G.
  - playwright: snapshot TopBar → при sample loading видна pill,
    после загрузки исчезает.
antithesis: |
  (1) «Critical CSS inline — premature без metrics». Возражение:
    Lighthouse покажет где именно FCP стоит; если не inline —
    fix не нужен. Решение: сначала lighthouse baseline, ПОТОМ
    inline если метрика красная.
  (2) «Lazy CM — UX cost (latency при первом score)». Возражение:
    latency < 200ms на fast 3G, юзер за это время не успеет
    заметить; alternative — show skeleton 100ms (T4 visual).
  (3) «createRoot dispose — overengineering». Возражение:
    HMR leak в dev, в prod — норм. Conditional `if (import.meta.hot)`
    = 1 строка, cost = 0.
synthesis: |
  4 файла модифицировать:

  1. `ui/src/styles/components.css` — добавить .piano-keys-inner
     с CSS-переменными, удалить inline-style sizing из
     PianoKeyboard.tsx.
  2. `ui/src/presentation/components/CodeMirrorEditor.tsx` —
     экспортировать через lazy wrapper:
     ```ts
     export const CodeMirrorEditor = lazy(() => import('./CodeMirrorEditorImpl'));
     ```
     Создать `CodeMirrorEditorImpl.tsx` с текущим содержимым.
     Или: dynamic-import при mount через `await import(...)`.
  3. `ui/index.html` — inline `<style>` с critical CSS
     (topbar + preset-row + tokens), defer stylesheet до
     `onload="this.rel='stylesheet'"`.
  4. `ui/src/infrastructure/audio/SampleLoader.ts` — emit progress
     callbacks, `uiState.sampleStatus` signal обновляется.
     TopBar показывает `.audio-loading-pill` (CSS-only, 200ms
     pulse).

  Audit: `ui/src/presentation/components/ScorePanel.tsx` —
  wrap CodeMirrorEditor lazy. `ui/src/presentation/state/
  uiState.ts:90` — обернуть createRoot в
  `if (import.meta.hot) import.meta.hot.dispose(() => dispose())`.
status: draft
supersession-of: math/wavecode-ui-design-overhaul/packet.md
axiom: A1
---

## Substrate

- `ui/src/presentation/components/PianoKeyboard.tsx` (modify):
  remove inline-style for width/height, rely on CSS variables.
- `ui/src/styles/components.css` (extend): `.piano-keys-inner
  { --white-w: 80px; --black-w: 50px; --piano-h: 220px }`,
  media-query for mobile.
- `ui/src/presentation/components/CodeMirrorEditor.tsx`
  (refactor): split into CodeMirrorEditorImpl (current logic) +
  CodeMirrorEditor (lazy export).
- `ui/index.html` (modify): inline critical CSS in head,
  defer main stylesheet.
- `ui/src/infrastructure/audio/SampleLoader.ts` (modify):
  progress callback → uiState.sampleStatus.
- `ui/src/presentation/state/uiState.ts` (extend):
  sampleStatus signal + setter.
- `ui/src/App.tsx` (modify): import sampleStatus pill, render
  in TopBar when loading.
- `ui/src/styles/components.css` (add): `.audio-loading-pill`
  with pulse animation.

## Verification

```bash
cd ui
npm run build   # check no inline-size styles in piano
npx vitest run
# lighthouse-ci separately (manual)
```

Manual: throttle 4G → FCP <1.5s. TopBar pill виден при sample
loading (появляется через ~100ms после первого user gesture).