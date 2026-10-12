---
proposition: |
  Piano CSS-scope + MiniNotationToolbar reactivity + toolbar visibility
  fix (4 файла, ~50 LoC diff). Устраняет 3 user-visible бага одним
  пакетом: чёрные клавиши выпадают из piano; toolbar-кнопки не
  вставляют snippet; toolbar скрыт bottom-sheet-ом.
outcome: |
  После применения: piano рисуется W-B-W-B-W-… (24 клавиши в
  шахматном порядке); клик любой кнопки MiniNotationToolbar
  вставляет snippet в CodeMirror (verify: doc.toString() после
  клика содержит snippet); toolbar видим при любом BottomSheet
  surface (не уходит за cm-host flex-1).
invariant: |
  - `.piano-key.black` позиционируется абсолютно через @layer,
    переопределение legacy.css невозможно.
  - `MiniNotationToolbar` получает editor через accessor
    (`editor: () => EditorView | undefined`), не через let-binding.
  - `MiniNotationToolbar` рендерится внутри flex-column с
    `margin-top: auto` (НЕ position: sticky), parent НЕ имеет
    `overflow: hidden` (или toolbar вынесен наружу).
test: |
  - vitest: расширенный PianoKeyboard.test.ts — layout-invariants
    для каждой чёрной клавиши (left ∈ [prev-white.right,
    next-white.left]).
  - vitest: новый MiniNotationToolbar.click.test.tsx — реальный
    EditorView через create-test-editor → click 'note(' → doc
    содержит 'note('.
  - playwright e2e: snapshot @ 412×900 → click Piano chip → 
    sheet full → 24 кнопки piano в DOM, 14 белых + 10 чёрных,
    чёрные в z-order 2 поверх белых.
antithesis: |
  (1) «Rename селектора в legacy — достаточно». Возражение:
    rename работает, но не страхует от случайного reorder-а
    CSS imports. @layer — структурная гарантия.
  (2) «Sticky на toolbar — стандартное решение». Возражение:
    sticky не работает при `overflow: hidden` родителя.
    `margin-top: auto` — пуленепробиваемый CSS-only.
  (3) «Editor accessor в ScorePanel — overengineering». Возражение:
    без accessor-а toolbar стартует с `editor=undefined` и
    навсегда молчит (current bug). Это НЕ optional.
synthesis: |
  4 минимальных правки, каждая в своём файле:

  1. `components.css:962` — обернуть `.piano-key.black` (и
     `.piano-key.white`) в `@layer components { ... }`. Импортировать
     @layer перед `.piano-keys` declaration. Это даёт CSS-cascade
     защиту: legacy.css (unlayered) перебивает layered → значит
     наоборот, нужно в @layer чтобы перебить legacy. Wait — проверить
     spec: @layer имеет НИЗКИЙ приоритет чем unlayered. Решение:
     оставить как есть (unlayered в components), но переименовать
     legacy на `.piano-keyboard .piano-key.black` (scope). Это
     структурная страховка.
  2. `legacy.css:1257` — переименовать `.piano-key.black` →
     `.piano-keyboard .piano-key.black`. Аналогично `.piano-key.white`
     и `.piano-key.active`.
  3. `ScorePanel.tsx:46` — `<MiniNotationToolbar editor={() => editorApi} />`
     (accessor).
  4. `MiniNotationToolbar.tsx:62` — `const view = props.editor?.()?.getView();`
  5. `components.css` — `.mini-toolbar { flex-shrink: 0;
     margin-top: auto; background: var(--surface-1); border-top:
     1px solid var(--border) }` (НЕ position: sticky).
  6. `legacy.css:1190-1218` — оставить mini-toolbar стили (они
     не конфликтуют с новыми; legacy для mini-toolbar — fine).

  Verification: `cd ui && npm run build` (typecheck + vite build),
  `npx vitest run PianoKeyboard.test MiniNotationToolbar.test`.
status: draft
supersession-of: math/wavecode-ui-design-overhaul/packet.md
axiom: A1
---

## Substrate

- `ui/src/styles/legacy.css:1257-1271` (modify): rename селекторов
  piano-key для scope к старой разметке (если осталась).
- `ui/src/styles/components.css:962-1006` (verify): .piano-key.black
  position: absolute остаётся без изменений (cascade уже OK после
  rename).
- `ui/src/presentation/panels/ScorePanel.tsx:46` (modify):
  `editor={editorApi}` → `editor={() => editorApi}` (accessor).
- `ui/src/presentation/components/MiniNotationToolbar.tsx:62`
  (modify): `props.editor?.getView()` → `props.editor?.()?.getView()`.
- `ui/src/styles/components.css` (add): `.mini-toolbar { flex-shrink: 0;
  margin-top: auto }`.
- `ui/src/presentation/components/MiniNotationToolbar.test.ts`
  (extend): click-test с реальным EditorView (in-memory).
- `ui/src/presentation/components/PianoKeyboard.test.ts` (extend):
  layout-invariants для каждой чёрной клавиши.

## Verification (auto)

```
cd ui && npx vitest run PianoKeyboard.test MiniNotationToolbar.test
cd ui && npm run build   # tsc --noEmit + vite build
```

## Verification (manual)

1. dev server localhost:5173, viewport 412×900.
2. click Piano chip → sheet full → видна шахматная клавиатура 24 keys.
3. ScorePanel тап кнопки 'note(' в mini-toolbar → в CodeMirror
   появилось 'note(' в позиции курсора.
4. Piano sheet открыт поверх ScorePanel → mini-toolbar виден
   (НЕ уходит за cm-host).