import { onMount } from 'solid-js';
import { installKeyboardShortcuts } from './uiState';

export type KeyboardShortcutHandlers = {
  readonly focusAI: () => void;
  readonly focusScore: () => void;
  readonly undoScore: () => void;
  readonly redoScore: () => void;
  readonly openAdmin?: () => void;
};

export const useKeyboardShortcuts = (handlers: KeyboardShortcutHandlers): void => {
  onMount(() => {
    installKeyboardShortcuts(handlers);
  });
};
