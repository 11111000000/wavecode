---
proposition: |
  После `math/wavecode-css-consolidate` (cascade layers) cascade
  декларативен: components > legacy. Но ~120 классов всё ещё
  определены ТОЛЬКО в `legacy.css` — они живут в нижнем
  приоритетном слое, без cascade-конфликтов, но в файле,
  который архитектурно «на вылет».

  Этот пакет переносит первую секцию — **TransportPanel +
  Playhead + preset/llm-select** — из `legacy.css` в
  `components.css` под существующий `@layer components`. После
  переноса определения остаются теми же (cascade не меняется,
  т.к. внутри одного layer'а побеждает source-order — а
  перенесённые правила попадают в конец components.css, что
  сохраняет их силу).

  Объём переноса:
    - `.preset-select, .llm-select` (lines 87-120)
    - `.transport-panel, .transport-controls` (lines 233-251)
    - `.cps-control, .cps-label, .cps-readout` (lines 253-323)
    - `.cps-presets, .cps-preset-btn` (lines 325-345)
    - `.bpm-indicator, .bpm-suffix` (lines 347-372)
    - `.swing-btn, .swing-btn-on, .swing-control, .swing-label,
       .swing-slider, .swing-readout, .swing-divisor` (lines 374-436)
    - `@media (max-width: 720px) { … }` mobile-override (lines 438-462)
    - `.playhead-track, .playhead` (lines 468-488)

  Итого: ~260 строк legacy.css → components.css. Один коммит.
antithesis: |
  (1) «Перенос в конец components.css — теперь они выигрывают
  у ВСЕХ остальных компонентов через source-order». Возражение:
  правила в components.css уже работают по cascade — source-order
  внутри слоя. Перенесённые правила попадают в конец слоя,
  поэтому побеждают старые components-правила с тем же
  specificity. Это и было поведение в legacy (тоже конец).
  Никакого semantic shift.
  (2) «Надо сначала проверить что классы ещё живы — может
  быть dead code». Возражение: все перечисленные классы
  используются в TransportPanel.tsx, PresetRow.tsx, и других
  hot-path компонентах. Smoke test (playwright) подтвердит.
  (3) «Почему не весь legacy.css за раз?». Возражение:
  безопаснее по секциям — если что-то ломается, revert =
  один коммит вместо 1000-строчного squash. После всех миграций
  legacy.css удаляется отдельным пакетом.
synthesis: |
  Два коммита:

  1. **`ui/src/styles/components.css`** (modify, +260 строк):
     append новую секцию «TransportPanel, Playhead, Selects»
     в конце файла (после wc-toolstrip, перед EOF). Сохраняем
     оригинальные комментарии-маркеры (TRANSPORT PANEL,
     PLAYHEAD, SELECT) для grep-навигации.

  2. **`ui/src/styles/legacy.css`** (modify, -260 строк):
     удалить те же секции. Файл сокращается с 1364 → ~1104
     строк.

  Cascade не меняется: components.css всё ещё > legacy.css
  по @layer priority, но внутри components.css перенесённые
  правила теперь идут последними → выигрывают у других
  components-правил того же specificity. Внутри legacy
  освободившееся место не заполняется.

  Verification:
    - typecheck: clean
    - vitest: 628/628 (TransportPanel.test.tsx покрывает
      cps/swing/bpm selectors)
    - build (vite): CSS bundle size delta < 1KB
    - smoke test (playwright): открыть #/app, проверить
      computed style cps-preset-btn (должен быть background:
      transparent после Phase 1 de-emphasis)
status: draft
---