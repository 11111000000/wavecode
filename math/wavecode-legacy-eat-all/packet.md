---
proposition: |
  Финальный пакет legacy.css eating: 11 оставшихся секций за один
  раз, затем — удаление `legacy.css` целиком.

  Секции (770 строк, 11 секций):
    1. APP SHELL        (.app, .app-header, .app-title,
                         .app-subtitle, .app-preset-row)
    2. BUTTON           (.preset-btn, .ctrl-btn, .mixer-btn,
                         .midi-io-btn, .ctrl-btn-primary,
                         .preset-btn-new, .ctrl-btn-record)
    3. SAVE PRESET BAR  (.save-preset-bar)
    4. SCORE PANEL      (.score-controls, .score-pane,
                         .score-debug, .score-empty-state,
                         + nested .score-panel-inner > selectors)
    5. MIDI I/O BAR     (.midi-io-bar, .midi-io-summary,
                         .midi-io-row, .midi-io-field,
                         .midi-io-label, .midi-io-btn)
    6. MIXER PANEL      (.mixer-panel, .mixer-row, .mixer-name,
                         .mixer-solo, .mixer-mute, .mixer-summary)
    7. RECORD           (.record-err, .record-btn,
                         .record-modal-*, .ctrl-btn-record)
    8. SHARE MODAL      (.share-modal, .share-modal-backdrop,
                         .share-modal-actions)
    9. CODEMIRROR       (.cm-host, .cm-theme-rules, ...)
   10. MINI-NOTATION    (.mini-toolbar, .mini-toolbar-btn)
   11. PIANO & STEP GRID (.piano-keyboard [dead, container never
                          in DOM], .piano-key, .piano-keys,
                          .piano-keys-inner, .piano-key-label,
                          .piano-key-followed,
                          .step-grid, .step-grid-*, .step-cell)

  После миграции:
    - legacy.css удаляется (770 строк → 0)
    - index.css: убрать `@import './styles/legacy.css' layer(legacy)`
    - `@layer legacy, components, ...` декларация в index.css
      остаётся: components и landing слои остаются, legacy
      становится пустым (declaration-only). Безвредно для cascade.

  Net effect:
    - components.css: 2753 → ~3500 строк (+~750)
    - legacy.css: удалён
    - Файлов в styles/: 7 → 6 (нет legacy.css)
    - Cascade layers: 7 → 6 объявлений (legacy декларация
      можно убрать, но не обязательно)
antithesis: |
  (1) «770 строк за один коммит — слишком большой diff для review».
    Возражение: это MECHANICAL move (sed extract + append), не
    design decision. Каждая строка legacy.css переезжает в
    components.css без модификации. Diff читается построчно.
    Smoke test (playwright + visual diff) — главный gate.
  (2) «Что если .piano-keyboard (dead) перенесём и он засорит
  components.css?». Возражение: 47 строк мёртвого CSS — мелочь.
    Удалим отдельным пакетом `wavecode-css-deadcode-eat` если
    станет мешать. Или inline сейчас — пакет рассчитан на
    тотальный mechanical move.
  (3) «Удаление @import сломает cascade-layers declaration в
  index.css?». Возражение: `@layer legacy, components, ...`
    declaration-only (без правил внутри) — валидный CSS.
    Cascade не меняется (legacy пуст → не влияет ни на что).
  (4) «Что если есть critical inline CSS в dist/index.html
    который ссылается на legacy-классы?». Возражение: посмотрим
    inline CSS при verification; если найдём — перенесём
    matching rules в inline.
synthesis: |
  Три коммита:

  1. **`refactor(ui): migrate all remaining legacy.css sections`
     to components.css** (~750 строк):
     - extract sections 1-11 from legacy.css
     - append to components.css with clear section headers
     - delete legacy.css content

  2. **`refactor(ui): drop legacy.css file and its @import`**:
     - `git rm ui/src/styles/legacy.css`
     - update index.css: remove `@import './styles/legacy.css' layer(legacy);`
     - update index.css header comment to reflect 6 layers (or
       keep 7 declaration with empty `legacy` — both valid)
     - update packet comment that referenced legacy.css

  3. **`docs(math): witness for wavecode-legacy-eat-all`**

  Verification:
    - typecheck: clean
    - vitest: 632/632
    - lint: 2 errors (preexisting)
    - build (vite): success; CSS bundle size delta ~+5KB
      (consolidated, no gzip impact)
    - smoke test (playwright): open #/app, navigate to all
      bottom-sheets (Step, Piano, Mixer, AI chat, Status),
      verify visual rendering matches Phase 1 expectations

  This packet retires `math/wavecode-css-consolidate/packet.md`
  (its Phase 2 gradual eating is now complete). Final cascade:
  tokens < base < components < sheets < icons < landing (6 layers).
status: applied
---