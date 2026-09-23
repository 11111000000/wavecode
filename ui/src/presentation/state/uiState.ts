import { createSignal, createEffect, onCleanup } from 'solid-js';

const KEY = 'wavecode-ui-state-v1';

type UIState = {
  replOpen: boolean;
  statusOpen: boolean;
};

const defaultState: UIState = {
  replOpen: true,
  statusOpen: true,
};

const loadState = (): UIState => {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultState;
    const parsed = JSON.parse(raw) as Partial<UIState>;
    return { ...defaultState, ...parsed };
  } catch {
    return defaultState;
  }
};

const saveState = (state: UIState) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
};

// Singleton state (shared across panels).
const initial = loadState();
export const [uiState, setUiState] = createSignal<UIState>(initial);

createEffect(() => {
  saveState(uiState());
});

export const toggleRepl = (): void => {
  setUiState((s) => ({ ...s, replOpen: !s.replOpen }));
};

export const toggleStatus = (): void => {
  setUiState((s) => ({ ...s, statusOpen: !s.statusOpen }));
};

// Keyboard shortcuts (emacs-inspired).
//   Ctrl+.       → focus REPL (also expands if collapsed)
//   Ctrl+,       → focus Score editor
//   Ctrl+Shift+R → toggle REPL
//   Ctrl+Shift+S → toggle Status
//   Ctrl+Enter   → eval (handled by REPL via textarea keydown)
export const installKeyboardShortcuts = (refs: {
  focusRepl: () => void;
  focusScore: () => void;
}): void => {
  const handler = (e: KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;

    if (e.key === '.') {
      e.preventDefault();
      if (!uiState().replOpen) toggleRepl();
      refs.focusRepl();
    } else if (e.key === ',') {
      e.preventDefault();
      refs.focusScore();
    } else if (e.shiftKey && e.key.toLowerCase() === 'r') {
      e.preventDefault();
      toggleRepl();
    } else if (e.shiftKey && e.key.toLowerCase() === 's') {
      e.preventDefault();
      toggleStatus();
    }
  };

  window.addEventListener('keydown', handler);
  onCleanup(() => window.removeEventListener('keydown', handler));
};