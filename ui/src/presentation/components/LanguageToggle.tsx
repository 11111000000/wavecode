import { type JSX, type Accessor, For } from 'solid-js';

import { languageMode, setLanguageMode } from '../state/languageModeStore';
import type { LanguageMode } from '~/domain/languageMode';

const OPTIONS: ReadonlyArray<{ value: LanguageMode; label: string; aria: string }> = [
  { value: 'js', label: 'JS', aria: 'JavaScript mode — score is JS code with mini-notation strings' },
  { value: 'lisp', label: 'Lisp', aria: 'Lisp mode — score is Scheme-like s-expressions' },
];

/**
 * Two-state toggle: JS ↔ Lisp.
 *
 * On change:
 *   - `setLanguageMode(next)` updates the Solid signal and persists
 *     to localStorage.
 *   - LiveAudioEngine invalidates its cached REPL on next eval —
 *     transpiler is swapped (see LiveAudioEngine.ensureRepl).
 *
 * The score text is NOT auto-translated. Switching mode is the user's
 * job — the editor's highlighting follows the chosen mode.
 */
export function LanguageToggle(): JSX.Element {
  const isLisp: Accessor<boolean> = () => languageMode() === 'lisp';

  const pick = (mode: LanguageMode): void => {
    setLanguageMode(mode);
  };

  return (
    <div
      class="wavecode-language-toggle"
      role="radiogroup"
      aria-label="Score language"
    >
      <For each={OPTIONS}>
        {(opt) => (
          <button
            type="button"
            role="radio"
            aria-checked={languageMode() === opt.value}
            aria-label={opt.aria}
            class={`wavecode-language-toggle__btn${
              languageMode() === opt.value ? ' is-active' : ''
            }${opt.value === 'lisp' && isLisp() ? ' is-lisp' : ''}`}
            onClick={() => pick(opt.value)}
            data-mode={opt.value}
          >
            {opt.label}
          </button>
        )}
      </For>
    </div>
  );
}