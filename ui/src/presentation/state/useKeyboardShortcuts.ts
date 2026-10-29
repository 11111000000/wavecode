import { onMount } from 'solid-js';
import { installKeyboardShortcuts } from './uiState';
import { aiExplainSelectedAccessor } from './editorSelection';

export type KeyboardShortcutHandlers = {
  readonly focusAI: () => void;
  readonly focusScore: () => void;
  readonly undoScore: () => void;
  readonly redoScore: () => void;
  readonly openAdmin?: () => void;
  /**
   * wavecode-editor-selection-ai: handler for Ctrl/Cmd+Shift+L.
   * The handler is intentionally registered as an OPTIONAL
   * field rather than a required one — App.tsx is frozen by
   * Slot 1.1 and the existing call site does not pass it.
   *
   * The implementation in `installKeyboardShortcuts` (in
   * uiState.ts) calls this lazily through
   * `aiExplainSelectedAccessor`, which AIEditPanel populates
   * from its own onMount via `registerAiExplainSelectedHandler`.
   * Lazy resolution means the order of mount does not matter:
   * by the time the user presses the hotkey, AIEditPanel has
   * registered its handler.
   */
  readonly aiExplainSelected?: () => void;
};

export const useKeyboardShortcuts = (handlers: KeyboardShortcutHandlers): void => {
  onMount(() => {
    installKeyboardShortcuts({
      ...handlers,
      // Wrap so we resolve the lazy module-level handler at
      // press-time, not at mount-time. If the caller passed an
      // explicit handler, prefer it (lets tests stub).
      aiExplainSelected: handlers.aiExplainSelected ?? ((): void => {
        aiExplainSelectedAccessor()?.();
      }),
    });
  });
};