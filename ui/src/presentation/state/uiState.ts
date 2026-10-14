import { createSignal, createEffect, onCleanup, createRoot } from 'solid-js';

const KEY = 'wavecode-ui-state-v1';
const MOBILE_MODE_KEY = 'wavecode-mobile-default';
const LAYOUT_KEY = 'wavecode-layout-v1';

export type Layout = 'code-primary' | 'ai-primary';

type UIState = {
  scoreOpen: boolean;
  aiOpen: boolean;
  statusOpen: boolean;
  layout: Layout;
};

export type MobileMode = 'auto' | 'compact' | 'full';

const isDesktopViewport = (): boolean => {
  if (typeof window === 'undefined' || typeof window.innerWidth !== 'number') {
    return true;
  }
  return window.innerWidth >= 1024;
};

const defaultLayout = (): Layout => (isDesktopViewport() ? 'ai-primary' : 'code-primary');

const loadStoredLayout = (): Layout | null => {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (raw === 'ai-primary' || raw === 'code-primary') return raw;
  } catch {
    /* ignore */
  }
  return null;
};

const defaultState: UIState = {
  scoreOpen: true,
  aiOpen: true,
  statusOpen: true,
  layout: defaultLayout(),
};

const compactState: UIState = {
  scoreOpen: true,
  aiOpen: false,
  statusOpen: false,
  layout: defaultLayout(),
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
  // Layout live'ит в отдельном ключе — чтобы не ломать обратную
  // совместимость с wavecode-ui-state-v1 (там только score/ai/status).
  const storedLayout = loadStoredLayout();
  const layout: Layout = storedLayout ?? defaultLayout();

  // Explicit per-panel state always wins (localStorage KEY).
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<UIState & { replOpen?: boolean }>;
      const { replOpen, ...rest } = parsed;
      return {
        ...defaultState,
        ...rest,
        layout,
        ...(replOpen !== undefined ? { aiOpen: replOpen } : {}),
      };
    }
  } catch {
    /* fall through to mode-based default */
  }

  // No explicit per-panel state — fall back to mobile-mode preference.
  // 'auto' consults matchMedia; 'compact'/'full' are explicit user pins.
  const mode = getMobileMode();
  if (mode === 'compact') return { ...compactState, layout };
  if (mode === 'full') return { ...defaultState, layout };
  return isMobileViewport() ? { ...compactState, layout } : { ...defaultState, layout };
};

const saveState = (state: UIState) => {
  try {
    // layout хранится отдельным ключом — вытаскиваем, чтобы не сломать
    // формат wavecode-ui-state-v1 для legacy-ридеров.
    const { layout: _layout, ...persisted } = state;
    localStorage.setItem(KEY, JSON.stringify(persisted));
  } catch {
    /* ignore */
  }
};

const saveLayout = (layout: Layout) => {
  try {
    localStorage.setItem(LAYOUT_KEY, layout);
  } catch {
    /* ignore */
  }
};

const initial = resolveInitialState();
export const [uiState, setUiState] = createSignal<UIState>(initial);

// Module-level reactive: оборачиваем в createRoot, чтобы не получать
// warning «computations created outside a createRoot or render will never
// be disposed» — эффект реально живёт всю сессию страницы.
// `import.meta.hot.dispose` сбрасывает root при HMR-reload, иначе
// старый effect продолжает держаться и каждый save пишет дубликат.
const _uiStateDispose = createRoot((d) => {
  createEffect(() => {
    saveState(uiState());
  });
  createEffect(() => {
    saveLayout(uiState().layout);
  });
  return d;
});
if (import.meta.hot) {
  import.meta.hot.dispose(() => _uiStateDispose());
}

// =========================================================================
// Sample-loader progress (idempotent, обновляется из App.tsx в onMount).
// TopBar показывает .audio-loading-pill пока status === 'loading'.
// =========================================================================

export type SampleStatus = 'idle' | 'loading' | 'ready';

const [sampleStatus, setSampleStatusRaw] = createSignal<SampleStatus>('idle');
const [sampleProgress, setSampleProgressRaw] = createSignal<{ loaded: number; total: number }>({ loaded: 0, total: 3 });

export const getSampleStatus = sampleStatus;
export const getSampleProgress = sampleProgress;
export const setSampleStatus = (next: SampleStatus): void => {
  setSampleStatusRaw(next);
};
export const setSampleProgress = (loaded: number, total: number): void => {
  setSampleProgressRaw({ loaded, total });
};

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
// Layout (desktop AI-primary vs mobile code-primary).
// =========================================================================

export const getLayout = (): Layout => uiState().layout;

export const setLayout = (layout: Layout): void => {
  if (uiState().layout === layout) return;
  setUiState((s) => ({ ...s, layout }));
};

// =========================================================================
// Bottom Sheet (mobile-first)
// =========================================================================

export type SheetKind = 'ai' | 'mixer' | 'step' | 'piano' | 'status' | 'share' | 'record' | null;
export type SheetSnap = 'closed' | 'peek' | 'half' | 'full';
export type TabId = 'score' | 'step' | 'piano' | 'mixer' | 'chat' | 'status';

/** wavecode-mobile-split-pane — sheet height (in CSS px) on mobile.
 *  null = snap-only (snap decides height via CSS rules in sheets.css
 *  `@media (max-width: 720px)`). Non-null = user-resized via
 *  drag-handle; persisted across sessions in localStorage. */
const SHEET_H_KEY = 'wavecode-mobile-sheet-h-v1';
// wavecode-mobile-compact: min raised from 240 → 360 so user can't
// drag the sheet below ~half-viewport on common phones. CSS
// .wc-sheet { min-height: 50vh } enforces the same cap visually.
export const SHEET_HEIGHT_MIN_PX = 360;
export const SHEET_HEIGHT_MAX_PX = 560;

const [sheetHeightPx, setSheetHeightPxRaw] = createSignal<number | null>(null);

export const getSheetHeightPx = sheetHeightPx;

export const setSheetHeightPx = (px: number): void => {
  const clamped = Math.max(SHEET_HEIGHT_MIN_PX, Math.min(SHEET_HEIGHT_MAX_PX, Math.round(px)));
  setSheetHeightPxRaw(clamped);
  try {
    localStorage.setItem(SHEET_H_KEY, String(clamped));
  } catch {
    /* localStorage unavailable — silently no-op */
  }
};

export const resetSheetHeightPx = (): void => {
  setSheetHeightPxRaw(null);
  try {
    localStorage.removeItem(SHEET_H_KEY);
  } catch {
    /* localStorage unavailable — silently no-op */
  }
};

const loadStoredSheetHeight = (): number | null => {
  try {
    const raw = localStorage.getItem(SHEET_H_KEY);
    if (raw === null) return null;
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n)) return null;
    if (n < SHEET_HEIGHT_MIN_PX || n > SHEET_HEIGHT_MAX_PX) return null;
    return n;
  } catch {
    return null;
  }
};

// Initialize from localStorage at module load.
setSheetHeightPxRaw(loadStoredSheetHeight());

// Reactive CSS var — every change to sheetHeightPx() updates
// `--sheet-h` on document root. sheets.css reads this var.
const _sheetHeightCssVarDispose = createRoot((d) => {
  createEffect(() => {
    const h = sheetHeightPx();
    if (typeof document === 'undefined') return;
    if (h === null) {
      document.documentElement.style.removeProperty('--sheet-h');
    } else {
      document.documentElement.style.setProperty('--sheet-h', `${h}px`);
    }
  });
  return d;
});
if (import.meta.hot) {
  import.meta.hot.dispose(() => _sheetHeightCssVarDispose());
}

const [activeSheet, setActiveSheetRaw] = createSignal<SheetKind>(null);
const [sheetSnap, setSheetSnap] = createSignal<SheetSnap>('closed');
const [activeTab, setActiveTab] = createSignal<TabId>('score');

export const getActiveSheet = activeSheet;
export const getSheetSnap = sheetSnap;
export const getActiveTab = activeTab;

/** True when at least one sheet (per-kind) is in a non-closed snap.
 *  Used by TabBar to apply a pulse to the "Score" tab (primary
 *  navigation back to the editor). */
export const hasOpenSheet = (): boolean => {
  const snaps = snapsByKind();
  for (const k of Object.keys(snaps) as NonNullable<SheetKind>[]) {
    if (snaps[k] !== 'closed') return true;
  }
  return false;
};

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
    openKindSheet('ai', 'full');
  } else if (tab === 'mixer') {
    openKindSheet('mixer', 'full');
  } else if (tab === 'status') {
    // Status — отдельный kind со своим BottomSheet, рендерит HelloPanel.
    openKindSheet('status', 'full');
  } else if (tab === 'step') {
    openKindSheet('step', 'full');
  } else if (tab === 'piano') {
    openKindSheet('piano', 'full');
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
  openAdmin?: () => void;
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
    } else if (e.shiftKey && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      refs.openAdmin?.();
    }
  };
  window.addEventListener('keydown', handler);
  onCleanup(() => window.removeEventListener('keydown', handler));
};
