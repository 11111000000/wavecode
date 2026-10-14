import { Show, type JSX } from 'solid-js';

import type { LanguageMode } from '~/domain/languageMode';

/**
 * Templates for a fresh composition, per language mode.
 *
 * - JS: short comment + a one-line Strudel snippet the user can edit
 *       immediately. Mirrors the existing `NEW_COMPOSITION_TEMPLATE`
 *       string in App.tsx.
 * - Lisp: comment explaining the dialect + a minimal `stack` example
 *        that the transpiler will turn into valid JS.
 */
export const NEW_JS_TEMPLATE = '// Начни новую композицию здесь\n';
export const NEW_LISP_TEMPLATE = [
  ';; Новая Lisp-композиция — Scheme-подобные s-выражения.',
  ';; Кнопка "→ JS" в правом верхнем углу транспнпилирует в JavaScript.',
  '(stack',
  '  (note "a4 b4 c5" (slow 2))',
  '  (s "bd sd hh"))',
].join('\n');

/**
 * Minimal modal: choose JS or Lisp for the new composition.
 * Rendered as an overlay on top of the editor. Backdrop click + Esc
 * cancel without committing.
 */
export type NewCompositionDialogProps = {
  readonly open: boolean;
  readonly onPick: (mode: LanguageMode) => void;
  readonly onCancel: () => void;
};

export function NewCompositionDialog(props: NewCompositionDialogProps): JSX.Element {
  return (
    <Show when={props.open}>
      <div
        class="wc-new-comp-backdrop"
        role="presentation"
        onClick={props.onCancel}
      >
        <div
          class="wc-new-comp-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="wc-new-comp-title"
          onClick={(e) => e.stopPropagation()}
        >
          <h2 id="wc-new-comp-title" class="wc-new-comp-title">
            Новая композиция
          </h2>
          <p class="wc-new-comp-subtitle">
            Выберите язык score. Этот выбор можно изменить позже
            кнопкой «→ JS» (транспиляция в JavaScript).
          </p>
          <div class="wc-new-comp-actions">
            <button
              type="button"
              class="wc-new-comp-btn"
              data-mode="js"
              onClick={() => props.onPick('js')}
              autofocus
            >
              <span class="wc-new-comp-btn__name">JavaScript</span>
              <span class="wc-new-comp-btn__hint">
                Strudel JS · <code>note("a4 b4 c5").slow(2)</code>
              </span>
            </button>
            <button
              type="button"
              class="wc-new-comp-btn"
              data-mode="lisp"
              onClick={() => props.onPick('lisp')}
            >
              <span class="wc-new-comp-btn__name">Lisp</span>
              <span class="wc-new-comp-btn__hint">
                Scheme s-выражения · <code>(note "a4" (slow 2))</code>
              </span>
            </button>
          </div>
          <button
            type="button"
            class="wc-new-comp-cancel"
            onClick={props.onCancel}
            aria-label="Отмена"
          >
            Отмена
          </button>
        </div>
      </div>
    </Show>
  );
}