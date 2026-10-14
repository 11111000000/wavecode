import { Show, type JSX } from 'solid-js';

import { transpileScoreToJs } from '~/application/useCases/transpileScore';
import { languageMode, setLanguageMode } from '../state/languageModeStore';
import { appStore, dispatch } from '../state/appStore';
import { consoleStore } from './consoleStore';

/**
 * "→ JS" button that converts a Lisp-mode score to its JS form in one click.
 *
 * Visible only when:
 *   - current mode is Lisp
 *   - score is non-empty
 *
 * On click: run `transpileScoreToJs`. On success — replace score and
 * flip mode to JS. On failure — show a toast, leave score and mode
 * unchanged. This is the user-driven counterpart of the deleted
 * `LanguageToggle`: rather than silently switching mode on a JS-shaped
 * score (which would break eval), the user explicitly opts in.
 */
export function TranspileButton(): JSX.Element {
  const isVisible = (): boolean =>
    languageMode() === 'lisp' && appStore.score.trim().length > 0;

  const onClick = (): void => {
    const r = transpileScoreToJs(appStore.score);
    if (r.ok) {
      dispatch({ type: 'replaceScore', text: r.js });
      setLanguageMode('js');
      consoleStore.pushToast({
        severity: 'info',
        title: 'Транспилировано в JavaScript',
      });
    } else {
      consoleStore.pushToast({
        severity: 'error',
        title: 'Transpile failed',
        body: r.error,
      });
    }
  };

  return (
    <Show when={isVisible()}>
      <button
        type="button"
        class="wavecode-transpile-btn"
        onClick={onClick}
        aria-label="Транспилировать Lisp в JavaScript"
        title="Конвертировать Lisp-скор в JavaScript"
        data-testid="transpile-to-js"
      >
        → JS
      </button>
    </Show>
  );
}