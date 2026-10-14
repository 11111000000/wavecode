import { Show, type JSX } from 'solid-js';

import { transpileScoreToJs } from '~/application/useCases/transpileScore';
import { detectLanguage } from '~/domain/languageMode';
import { setLanguageMode } from '../state/languageModeStore';
import { appStore, dispatch } from '../state/appStore';
import { consoleStore } from './consoleStore';

/**
 * "→ JS" button that converts a Lisp-mode score to its JS form in one click.
 *
 * Visible only when the current score ACTUALLY contains Lisp (detected
 * from content via `detectLanguage`), NOT from persisted mode state — a
 * stale `localStorage` `lisp` value while the score is still JS must not
 * leave a dangling button.
 *
 * On click: run `transpileScoreToJs`. On success — replace score and
 * clear the persisted mode to `js`. On failure — show a toast, leave
 * score and mode unchanged.
 */
export function TranspileButton(): JSX.Element {
  const isVisible = (): boolean =>
    detectLanguage(appStore.score) === 'lisp' && appStore.score.trim().length > 0;

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