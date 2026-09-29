import { createSignal, createEffect, onCleanup } from 'solid-js';

const KEY = 'wavecode-ui-state-v1';

type UIState = {
  aiOpen: boolean;
  statusOpen: boolean;
};

const defaultState: UIState = {
  aiOpen: true,
  statusOpen: true,
};

const loadState = (): UIState => {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultState;
    const parsed = JSON.parse(raw) as Partial<UIState & { replOpen?: boolean }>;
    // Migrate legacy replOpen → aiOpen.
    const { replOpen, ...rest } = parsed;
    return { ...defaultState, ...rest, ...(replOpen !== undefined ? { aiOpen: replOpen } : {}) };
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

const initial = loadState();
export const [uiState, setUiState] = createSignal<UIState>(initial);

createEffect(() => {
  saveState(uiState());
});

export const toggleAI = (): void => {
  setUiState((s) => ({ ...s, aiOpen: !s.aiOpen }));
};

export const toggleStatus = (): void => {
  setUiState((s) => ({ ...s, statusOpen: !s.statusOpen }));
};

// Keyboard shortcuts (emacs-inspired).
//   Ctrl+.       → focus AI textarea (also expands if collapsed)
//   Ctrl+,       → focus Score editor
//   Ctrl+Shift+R → toggle AI
//   Ctrl+Shift+S → toggle Status
//   Ctrl+Enter   → submit AI instruction
export const installKeyboardShortcuts = (refs: {
  focusAI: () => void;
  focusScore: () => void;
}): void => {
  const handler = (e: KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;

    if (e.key === '.') {
      e.preventDefault();
      if (!uiState().aiOpen) toggleAI();
      refs.focusAI();
    } else if (e.key === ',') {
      e.preventDefault();
      refs.focusScore();
    } else if (e.shiftKey && e.key.toLowerCase() === 'r') {
      e.preventDefault();
      toggleAI();
    } else if (e.shiftKey && e.key.toLowerCase() === 's') {
      e.preventDefault();
      toggleStatus();
    }
  };

  window.addEventListener('keydown', handler);
  onCleanup(() => window.removeEventListener('keydown', handler));
};
