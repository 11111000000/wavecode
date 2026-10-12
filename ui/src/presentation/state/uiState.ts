import { createSignal, createEffect, onCleanup, createRoot } from 'solid-js';

const KEY = 'wavecode-ui-state-v1';
const MOBILE_MODE_KEY = 'wavecode-mobile-default';

type UIState = {
  scoreOpen: boolean;
  aiOpen: boolean;
  statusOpen: boolean;
};

export type MobileMode = 'auto' | 'compact' | 'full';

const defaultState: UIState = {
  scoreOpen: true,
  aiOpen: true,
  statusOpen: true,
};

const compactState: UIState = {
  scoreOpen: true,
  aiOpen: false,
  statusOpen: false,
};

const isMobileViewport = (): boolean => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(max-width: 720px)').matches;
};

export const getMobileMode = (): MobileMode => {
  try {
    const raw = localStorage.getItem(MOBILE_MODE_KEY);
    if (raw === 'compact' || raw === 'full' || raw === 'auto') return raw;
  } catch {
    /* ignore */
  }
  return 'auto';
};

export const setMobileMode = (mode: MobileMode): void => {
  try {
    localStorage.setItem(MOBILE_MODE_KEY, mode);
  } catch {
    /* ignore */
  }
};

const resolveInitialState = (): UIState => {
  // Explicit per-panel state always wins (localStorage KEY).
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<UIState & { replOpen?: boolean }>;
      const { replOpen, ...rest } = parsed;
      return {
        ...defaultState,
        ...rest,
        ...(replOpen !== undefined ? { aiOpen: replOpen } : {}),
      };
    }
  } catch {
    /* fall through to mode-based default */
  }

  // No explicit per-panel state — fall back to mobile-mode preference.
  // 'auto' consults matchMedia; 'compact'/'full' are explicit user pins.
  const mode = getMobileMode();
  if (mode === 'compact') return compactState;
  if (mode === 'full') return defaultState;
  return isMobileViewport() ? compactState : defaultState;
};

const saveState = (state: UIState) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
};

const initial = resolveInitialState();
export const [uiState, setUiState] = createSignal<UIState>(initial);

// Module-level reactive: оборачиваем в createRoot, чтобы не получать
// warning «computations created outside a createRoot or render will never
// be disposed» — эффект реально живёт всю сессию страницы.
createRoot(() => {
  createEffect(() => {
    saveState(uiState());
  });
});

export const toggleScore = (): void => {
  setUiState((s) => ({ ...s, scoreOpen: !s.scoreOpen }));
};

export const toggleAI = (): void => {
  setUiState((s) => ({ ...s, aiOpen: !s.aiOpen }));
};

export const toggleStatus = (): void => {
  setUiState((s) => ({ ...s, statusOpen: !s.statusOpen }));
};

// =========================================================================
// Bottom Sheet (mobile-first)
// =========================================================================

export type SheetKind = 'ai' | 'mixer' | 'step' | 'piano' | 'status' | 'share' | 'record' | null;
export type SheetSnap = 'closed' | 'peek' | 'half' | 'full';
export type TabId = 'score' | 'chat' | 'mixer' | 'status';

const [activeSheet, setActiveSheetRaw] = createSignal<SheetKind>(null);
const [sheetSnap, setSheetSnap] = createSignal<SheetSnap>('closed');
const [activeTab, setActiveTab] = createSignal<TabId>('score');

export const getActiveSheet = activeSheet;
export const getSheetSnap = sheetSnap;
export const getActiveTab = activeTab;

/** Close every open sheet — used by "score" tab и для сброса глобального overlay. */
export const closeAllSheets = (): void => {
  setSnapsByKindRaw((m) => {
    const next = { ...m };
    for (const k of Object.keys(next) as NonNullable<SheetKind>[]) next[k] = 'closed';
    return next;
  });
  setActiveSheetRaw(null);
  setSheetSnap('closed');
  if (typeof document !== 'undefined') {
    document.body.setAttribute('data-sheet-open', 'false');
  }
};

/** Синоним для обратной совместимости; делегирует в closeAllSheets. */
export const closeSheet = closeAllSheets;

/** Открыть sheet и одновременно синхронизировать snapsByKind для этого kind.
 *  BottomSheet.tsx рендерится по getKindSnap(kind), а не по global activeSheet —
 *  поэтому обязательно обновлять оба state при каждом открытии. */
export const openSheet = (kind: NonNullable<SheetKind>, snap: SheetSnap = 'half'): void => {
  setSnapsByKindRaw((m) => ({ ...m, [kind]: snap }));
  setActiveSheetRaw(kind);
  setSheetSnap(snap);
  if (typeof document !== 'undefined') {
    document.body.setAttribute('data-sheet-open', 'true');
  }
};

/** Изменить snap текущего активного sheet (используется BottomSheet при drag).
 *  Синхронизирует snapsByKind — иначе после drag reopened sheet "забудет" snap. */
export const snapTo = (snap: SheetSnap): void => {
  const kind = activeSheet();
  if (kind !== null) {
    setSnapsByKindRaw((m) => ({ ...m, [kind]: snap }));
  }
  setSheetSnap(snap);
};

/** Snap per-kind — несколько sheet'ов могут быть открыты каждый со своим snap. */
const [snapsByKind, setSnapsByKindRaw] = createSignal<Record<NonNullable<SheetKind>, SheetSnap>>({
  ai: 'closed', mixer: 'closed', step: 'closed', piano: 'closed', status: 'closed', share: 'closed', record: 'closed',
});
export const getSnapsByKind = snapsByKind;
export const getKindSnap = (kind: NonNullable<SheetKind>): SheetSnap => snapsByKind()[kind];
/** Single-active semantics: открыть sheet для kind и закрыть все остальные.
 *  BottomSheet рендерится по getKindSnap для своего kind; если в этом state
 *  одновременно "full" у двух sheets — оба оказываются на translateY(0),
 *  и поверхний прячет нижний. close-on-switch предотвращает это. */
export const openKindSheet = (kind: NonNullable<SheetKind>, snap: SheetSnap = 'half'): void => {
  setSnapsByKindRaw((m) => {
    const next = { ...m };
    for (const k of Object.keys(next) as NonNullable<SheetKind>[]) next[k] = 'closed';
    next[kind] = snap;
    return next;
  });
  setActiveSheetRaw(kind);
  setSheetSnap(snap);
  if (typeof document !== 'undefined') {
    document.body.setAttribute('data-sheet-open', 'true');
  }
};
export const closeKindSheet = (kind: NonNullable<SheetKind>): void => {
  setSnapsByKindRaw((m) => ({ ...m, [kind]: 'closed' }));
  if (snapsByKind()[kind] === 'closed' && getActiveSheet() === kind) {
    setActiveSheetRaw(null);
    setSheetSnap('closed');
  }
  if (typeof document !== 'undefined') {
    document.body.setAttribute('data-sheet-open', 'false');
  }
};
export const setTab = (tab: TabId): void => {
  setActiveTab(tab);
  if (tab === 'chat') {
    openKindSheet('ai', 'half');
  } else if (tab === 'mixer') {
    openKindSheet('mixer', 'full');
  } else if (tab === 'status') {
    // Status — отдельный kind со своим BottomSheet, рендерит HelloPanel.
    openKindSheet('status', 'full');
  } else if (tab === 'score') {
    closeAllSheets();
  }
};

/** Toggle the Status overlay (full-screen on mobile, in-place on desktop). */
const [statusOverlayOpen, setStatusOverlayRaw] = createSignal(false);
export const getStatusOverlayOpen = statusOverlayOpen;
export const openStatusOverlay = (): void => {
  setStatusOverlayRaw(true);
  setActiveTab('status');
};
export const closeStatusOverlay = (): void => {
  setStatusOverlayRaw(false);
  setActiveTab('score');
};

// =========================================================================
// Keyboard shortcuts (emacs-inspired).
//   Ctrl+.        → focus AI textarea (also expands if collapsed)
//   Ctrl+,        → focus Score editor (also expands if collapsed)
//   Ctrl+Shift+R  → toggle AI
//   Ctrl+Shift+S  → toggle Status
//   Ctrl+Shift+E  → toggle Score
//   Ctrl+Enter    → submit AI instruction
//   Ctrl+Z        → undo score (when focus outside text input — see refs.undoScore)
//   Ctrl+Y        → redo score
//   Ctrl+Shift+Z  → redo score (Windows convention)
export const installKeyboardShortcuts = (refs: {
  focusAI: () => void;
  focusScore: () => void;
  undoScore: () => void;
  redoScore: () => void;
}): void => {
  const handler = (e: KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;

    // Skip undo/redo when user is typing in a text field (let native
    // text undo handle per-character edits in inputs/textareas).
    const target = e.target as HTMLElement | null;
    const inTextField = target instanceof HTMLTextAreaElement
      || (target instanceof HTMLInputElement && target.type !== 'checkbox' && target.type !== 'radio');

    if (!inTextField && !e.shiftKey && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      refs.undoScore();
    } else if (!inTextField && ((e.shiftKey && e.key.toLowerCase() === 'z') || (!e.shiftKey && e.key.toLowerCase() === 'y'))) {
      e.preventDefault();
      refs.redoScore();
    } else if (e.key === '.') {
      e.preventDefault();
      if (!uiState().aiOpen) toggleAI();
      refs.focusAI();
    } else if (e.key === ',') {
      e.preventDefault();
      if (!uiState().scoreOpen) toggleScore();
      refs.focusScore();
    } else if (e.shiftKey && e.key.toLowerCase() === 'r') {
      e.preventDefault();
      toggleAI();
    } else if (e.shiftKey && e.key.toLowerCase() === 's') {
      e.preventDefault();
      toggleStatus();
    } else if (e.shiftKey && e.key.toLowerCase() === 'e') {
      e.preventDefault();
      toggleScore();
    }
  };
  window.addEventListener('keydown', handler);
  onCleanup(() => window.removeEventListener('keydown', handler));
};
