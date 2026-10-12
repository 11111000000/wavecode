---
proposition: |
  App.tsx split: 530 строк god-component → 4 sub-components
  (TopBar, PresetRow, PanelsLayout, BottomSheets), App.tsx
  остаётся ~50 строк (composition + onMount). Заодно:
  inline-styles (4 блока) → CSS-классы; legacy.css dead-rule
  removal (-30% размера: 36KB → 25KB); z-index audit (все через
  токены --z-*, никаких magic numbers).
outcome: |
  App.tsx <80 строк (composition + effects only).
  legacy.css <28KB после dead-rule audit.
  `grep -rn 'z-index:' ui/src/styles/` — только в tokens.css.
  Inline-style objects в App.tsx = 0.
invariant: |
  - 4 sub-components в `ui/src/presentation/components/app/`:
    `TopBar.tsx`, `PresetRow.tsx`, `PanelsLayout.tsx`,
    `BottomSheets.tsx`.
  - Каждый sub-component отвечает Props до 5 (props typed
    via SolidJS.JSX.IntrinsicElements или интерфейс).
  - Legacy.css содержит ТОЛЬКО классы, которые находятся через
    `rg -l '\.classname' ui/src/` хотя бы в одном файле.
test: |
  - tsc --noEmit — все типы проходят.
  - vite build — успешно.
  - grep `'style=\{\{'` ui/src/App.tsx — 0 результатов.
  - `rg -l '\.unused-class' ui/src/` — 0 результатов для
    каждого legacy-селектора.
antithesis: |
  (1) «Split — overengineering для текущего размера». Возражение:
    530 строк App.tsx смешивают 4 ответственности; split улучшает
    readability + per-component code-splitting в Vite.
  (2) «Dead-rule removal — риск regression». Возражение: rg audit
    = strict gate, если селектор не используется — удаление
    безопасно. Если где-то используется косвенно (CSS @apply,
    CSS-in-JS) — rg найдёт.
  (3) «z-index через токены — overengineering». Возражение:
    3 разных baseline = collision risk; единый scale =
    детерминированная семантика.
synthesis: |
  Substrate:

  1. Создать `ui/src/presentation/components/app/TopBar.tsx` —
     вынести строки App.tsx:280-389 (topbar header + actions).
     Props: { audioRunning: boolean; ctxState: () => CtxState;
     onRollback, onRedo, onNew, onSavePreset, onMobileMode,
     mobileMenuOpen, mobileMode, chooseMobileMode,
     deleteCurrentPreset, onResetAll, presetId, showMobileMenu,
     setShowMobileMenu, canUndo, canRedo }.
  2. Создать `PresetRow.tsx` — строки 391-448. Props:
     { presetId, loadPreset, showStepGrid, showPiano,
     toggleStepGrid, togglePiano, beep, showSavePreset,
     setShowSavePreset, newPresetName, setNewPresetName,
     onSavePreset, customPresetCount, presetsBuiltin }.
  3. Создать `PanelsLayout.tsx` — строки 450-485. Pure
     children-render: score/ai/status panels.
  4. Создать `BottomSheets.tsx` — строки 487-527. Pure render.
  5. App.tsx: оставить composition (<TopBar>, <PresetRow>,
     <PanelsLayout>, <BottomSheets>, <FAB>, <DebugPanel>) +
     onMount effects (loadAllSamples, repo.loadScore,
     saveTimers, keyboard shortcuts).
  6. Inline-styles → classes: `.app-preset-row`, `.save-preset-
     bar`, `.step-sheet-body`, `.piano-sheet-body`.
  7. legacy.css: для каждого `.foo` селектора запустить
     `rg -l '\.foo' ui/src/`; если пусто — удалить правило.
     Цель: -30% размера (36KB → 25KB).
  8. Z-index audit: `rg 'z-index:' ui/src/styles/` — все кроме
     tokens.css переписать через var(--z-*).
status: draft
supersession-of: math/wavecode-ui-design-overhaul/packet.md
axiom: A1
---

## Substrate

- `ui/src/presentation/components/app/TopBar.tsx` (new):
  extracted from App.tsx.
- `ui/src/presentation/components/app/PresetRow.tsx` (new).
- `ui/src/presentation/components/app/PanelsLayout.tsx` (new).
- `ui/src/presentation/components/app/BottomSheets.tsx` (new).
- `ui/src/App.tsx` (rewrite): ~80 строк composition + effects.
- `ui/src/styles/legacy.css` (audit + remove dead rules).
- `ui/src/styles/components.css` (extend): classes for inline
  styles.
- `ui/src/styles/{sheets,base}.css` (audit): replace magic
  z-index values with var(--z-*).

## Verification

```bash
cd ui
wc -l src/App.tsx   # должно быть <100
wc -l src/styles/legacy.css   # должно быть <800
npm run build
npx vitest run
```