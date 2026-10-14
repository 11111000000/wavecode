---
proposition: |
  Score в Lisp-режиме можно конвертировать в JS одной кнопкой "Transpile
  to JS". Toggle языка (LanguageToggle) убран: переключение mode теперь
  происходит ТОЛЬКО через модальное окно "Новая композиция" (выбор JS /
  Lisp при создании). Reset all возвращён как видимая кнопка в TopBar.
antithesis: |
  Альтернативы: (1) оставить toggle, добавить auto-transpile (отвергнуто
  — пользователь хочет явный контроль); (2) auto-detect mode from score
  (ненадёжно, неоднозначно); (3) reverse transpiler JS→Lisp (отвергнуто
  — пользователь сказал "трансляция в одну сторону"). Симметричный
  JS→Lisp избыточен, когда LLM и так пишет в текущем mode.
synthesis: |
  Toggle убран — слишком "магический" (mode меняется, но score остаётся,
  и eval ломается). Вместо этого: явная кнопка "Transpile to JS" в
  ScorePanel (показывается только в Lisp-режиме при непустом score).
  При создании новой композиции — modal с выбором JS / Lisp + Шаблон.
  Reset all возвращён в TopBar как видимая иконочная кнопка. JS→Lisp
  НЕ делаем — пользователь хочет Lisp-first workflow: пишет в Lisp,
  конвертит в JS для сохранения в JS-only preset.
substrate: |
  ui/src/application/useCases/transpileScore.ts (новый)
  ui/src/application/useCases/transpileScore.test.ts (новый)
  ui/src/presentation/components/TranspileButton.tsx (новый)
  ui/src/presentation/panels/ScorePanel.tsx (заменить LanguageToggle)
  ui/src/App.tsx (модалка New composition)
  ui/src/presentation/components/app/TopBar.tsx (ResetIcon обратно)
  ui/src/presentation/components/LanguageToggle.tsx (удалить)
  ui/src/styles/components.css (убрать старые toggle-стили, добавить Transpile)
status: applied
axiom: A1
epistemics:
  - statement: "LanguageToggle (JS/Lisp pill) сбивал пользователей с толку — переключал mode, но score не конвертировал"
    marker: fact
    evidence: "user feedback 2026-10-14: 'переключатель вообще ничего не делает, остается код на том же самом языке'"
  - statement: "lispTranspiler покрывает 33 golden pairs — round-trip verified в goldenPairs.test.ts"
    marker: fact
    evidence: "ui/src/infrastructure/lisp/goldenPairs.test.ts (71 tests pass)"
  - statement: "Reset all уже был в OverflowMenu ⋯, но недостаточно обнаружим"
    marker: judgment
    evidence: "user feedback: 'куда-то делась кнопка сбросить все настройки'"
  - statement: "Transpile on-demand — пользователь сам решает когда конвертировать, без silent corruption"
    marker: judgment
---

## Intent

Lisp → JS: явная кнопка, видимая в ScorePanel только при `mode === 'lisp'`
и непустом score. Клик пробует `lispTranspiler`:
- success → `dispatch({type:'replaceScore', text: jsOutput})` + `setLanguageMode('js')`
- failure → toast "не удалось транспнпилировать: <reason>"

## Что это НЕ

- **НЕ JS→Lisp.** Пользователь сказал "только в одну сторону" — Lisp→JS.
- **НЕ auto-transpile на toggle.** Toggle убран; mode меняется только при
  New Composition или явном Transpile.
- **НЕ silent mode switch.** Пользователь контролирует каждое изменение
  mode/score.

## UX-flow

### New Composition (App.tsx)
- Клик "Новая" → confirm (window.confirm ИЛИ modal) → выбор языка:
  - **JavaScript** — старый шаблон, mode='js'.
  - **Lisp** — Lisp-шаблон `;; Новая Lisp-композиция\n(stack ...)`, mode='lisp'.
- После выбора — `dispatch(replaceScore)`, `setLanguageMode`, `clearMessages`, `setSelectedPresetPersist('creep')`.

### Transpile to JS (ScorePanel)
- Кнопка `→ JS` показывается только при `mode === 'lisp' && score.trim() !== ''`.
- Клик → `transpileScoreToJs(currentScore)`:
  - ok → `dispatch(replaceScore, js)` + `setLanguageMode('js')`.
  - err → toast "transpile failed: <err>".

### Reset All (TopBar)
- Иконочная кнопка `↺` в TopBar (рядом с Undo/Redo).
- Клик → window.confirm "Сбросить ВСЕ настройки?" → `resetAllBrowserData()`.

## Worked example

```ts
// ui/src/application/useCases/transpileScore.ts
import { lispTranspiler } from '~/infrastructure/lisp/transpiler';
import { LispSyntaxError } from '~/infrastructure/lisp/lexer';

export type TranspileResult =
  | { readonly ok: true; readonly js: string }
  | { readonly ok: false; readonly error: string };

export const transpileScoreToJs = (source: string): TranspileResult => {
  const trimmed = source.trim();
  if (!trimmed) return { ok: false, error: 'empty score' };
  const r = lispTranspiler(source, null);
  if (r.errors.length > 0) {
    return { ok: false, error: r.errors[0]?.message ?? 'unknown' };
  }
  return { ok: true, js: r.output };
};
```

```tsx
// ui/src/presentation/components/TranspileButton.tsx
export function TranspileButton() {
  const onClick = () => {
    const r = transpileScoreToJs(appStore.score);
    if (r.ok) {
      dispatch({ type: 'replaceScore', text: r.js });
      setLanguageMode('js');
    } else {
      showToast(`Transpile failed: ${r.error}`);
    }
  };
  return (
    <Show when={languageMode() === 'lisp' && appStore.score.trim() !== ''}>
      <button onClick={onClick} class="transpile-btn" title="Конвертировать Lisp → JS">
        → JS
      </button>
    </Show>
  );
}
```

## Status

**applied.** Implementation в работе.