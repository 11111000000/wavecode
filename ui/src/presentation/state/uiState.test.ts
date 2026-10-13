import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

type MatchMediaMock = (query: string) => MediaQueryList;

const setMatchMedia = (matches: boolean): void => {
  const mql = {
    matches,
    media: '(max-width: 720px)',
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => true,
  } as unknown as MediaQueryList;
  const fn = ((query: string) => {
    if (query === '(max-width: 720px)') return mql;
    return { ...mql, matches: false, media: query } as unknown as MediaQueryList;
  }) as unknown as MatchMediaMock;
  Object.defineProperty(window, 'matchMedia', { value: fn, writable: true, configurable: true });
};

const clearMatchMedia = (): void => {
  delete (window as { matchMedia?: unknown }).matchMedia;
};

describe('uiState mobile mode', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  afterEach(() => {
    clearMatchMedia();
  });

  it('returns desktop default state when no storage and no matchMedia', async () => {
    clearMatchMedia();
    const { uiState } = await import('./uiState');
    expect(uiState()).toEqual({ scoreOpen: true, aiOpen: true, statusOpen: true, layout: 'ai-primary' });
  });

  it('returns compact state when matchMedia matches mobile and no storage', async () => {
    setMatchMedia(true);
    const { uiState } = await import('./uiState');
    expect(uiState()).toEqual({ scoreOpen: true, aiOpen: false, statusOpen: false, layout: 'ai-primary' });
  });

  it('returns desktop default state when matchMedia does not match', async () => {
    setMatchMedia(false);
    const { uiState } = await import('./uiState');
    expect(uiState()).toEqual({ scoreOpen: true, aiOpen: true, statusOpen: true, layout: 'ai-primary' });
  });

  it('explicit per-panel state in localStorage beats matchMedia', async () => {
    setMatchMedia(true); // would normally produce compact
    localStorage.setItem('wavecode-ui-state-v1', JSON.stringify({ scoreOpen: true, aiOpen: true, statusOpen: true }));
    const { uiState } = await import('./uiState');
    expect(uiState()).toEqual({ scoreOpen: true, aiOpen: true, statusOpen: true, layout: 'ai-primary' });
  });

  it('compact mode preference in localStorage beats matchMedia desktop', async () => {
    setMatchMedia(false);
    localStorage.setItem('wavecode-mobile-default', 'compact');
    const { uiState } = await import('./uiState');
    expect(uiState()).toEqual({ scoreOpen: true, aiOpen: false, statusOpen: false, layout: 'ai-primary' });
  });

  it('full mode preference forces default state on mobile', async () => {
    setMatchMedia(true);
    localStorage.setItem('wavecode-mobile-default', 'full');
    const { uiState } = await import('./uiState');
    expect(uiState()).toEqual({ scoreOpen: true, aiOpen: true, statusOpen: true, layout: 'ai-primary' });
  });

  it('auto mode still defers to matchMedia', async () => {
    setMatchMedia(true);
    localStorage.setItem('wavecode-mobile-default', 'auto');
    const { uiState } = await import('./uiState');
    expect(uiState()).toEqual({ scoreOpen: true, aiOpen: false, statusOpen: false, layout: 'ai-primary' });
  });

  it('getMobileMode defaults to auto when nothing in localStorage', async () => {
    const { getMobileMode } = await import('./uiState');
    expect(getMobileMode()).toBe('auto');
  });

  it('getMobileMode returns the stored value', async () => {
    localStorage.setItem('wavecode-mobile-default', 'compact');
    const { getMobileMode } = await import('./uiState');
    expect(getMobileMode()).toBe('compact');
  });

  it('getMobileMode returns auto for invalid stored value', async () => {
    localStorage.setItem('wavecode-mobile-default', 'something-weird');
    const { getMobileMode } = await import('./uiState');
    expect(getMobileMode()).toBe('auto');
  });

  it('setMobileMode persists to localStorage', async () => {
    const { setMobileMode, getMobileMode } = await import('./uiState');
    setMobileMode('full');
    expect(localStorage.getItem('wavecode-mobile-default')).toBe('full');
    expect(getMobileMode()).toBe('full');
  });

  it('migrates legacy replOpen to aiOpen on load', async () => {
    localStorage.setItem('wavecode-ui-state-v1', JSON.stringify({ replOpen: true, statusOpen: false }));
    setMatchMedia(false);
    const { uiState } = await import('./uiState');
    expect(uiState()).toEqual({ scoreOpen: true, aiOpen: true, statusOpen: false, layout: 'ai-primary' });
  });

  it('falls back to default when stored JSON is malformed', async () => {
    setMatchMedia(true);
    localStorage.setItem('wavecode-ui-state-v1', '{not valid json');
    const { uiState } = await import('./uiState');
    // Falls through to mobile-mode resolution → compact on mobile
    expect(uiState()).toEqual({ scoreOpen: true, aiOpen: false, statusOpen: false, layout: 'ai-primary' });
  });
});

describe('uiState layout (code-primary / ai-primary)', () => {
  let originalInnerWidth: number;

  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
    originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { value: 1280, writable: true, configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: originalInnerWidth, writable: true, configurable: true });
    clearMatchMedia();
  });

  it('getLayout() defaults to ai-primary on desktop viewport (1280×800)', async () => {
    const { getLayout } = await import('./uiState');
    expect(getLayout()).toBe('ai-primary');
  });

  it('setLayout("code-primary") roundtrips via getLayout()', async () => {
    const { getLayout, setLayout } = await import('./uiState');
    expect(getLayout()).toBe('ai-primary');
    setLayout('code-primary');
    expect(getLayout()).toBe('code-primary');
  });

  it('setLayout persists to wavecode-layout-v1 in localStorage', async () => {
    const { setLayout } = await import('./uiState');
    setLayout('code-primary');
    expect(localStorage.getItem('wavecode-layout-v1')).toBe('code-primary');
  });
});

describe('uiState bottom-sheet sync', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it('openSheet synchronizes snapsByKind[kind]', async () => {
    const { openSheet, getKindSnap } = await import('./uiState');
    openSheet('mixer', 'full');
    expect(getKindSnap('mixer')).toBe('full');
    expect(getKindSnap('ai')).toBe('closed');
  });

  it('openKindSheet closes other sheets (single-active)', async () => {
    const { openKindSheet, getKindSnap } = await import('./uiState');
    openKindSheet('mixer', 'full');
    openKindSheet('status', 'full');
    expect(getKindSnap('mixer')).toBe('closed');
    expect(getKindSnap('status')).toBe('full');
  });

  it('closeAllSheets clears every kind', async () => {
    const { openKindSheet, closeAllSheets, getKindSnap } = await import('./uiState');
    openKindSheet('ai', 'half');
    openKindSheet('mixer', 'full');
    closeAllSheets();
    expect(getKindSnap('ai')).toBe('closed');
    expect(getKindSnap('mixer')).toBe('closed');
    expect(getKindSnap('status')).toBe('closed');
    expect(getKindSnap('step')).toBe('closed');
  });

  it('setTab(mixer) opens mixer sheet at full', async () => {
    const { setTab, getKindSnap, getActiveTab } = await import('./uiState');
    setTab('mixer');
    expect(getActiveTab()).toBe('mixer');
    expect(getKindSnap('mixer')).toBe('full');
  });

  it('setTab(status) opens status sheet at full (not AI)', async () => {
    const { setTab, getKindSnap } = await import('./uiState');
    setTab('status');
    expect(getKindSnap('status')).toBe('full');
    expect(getKindSnap('ai')).toBe('closed');
  });

  it('setTab(score) closes all sheets', async () => {
    const { setTab, openKindSheet, getKindSnap } = await import('./uiState');
    openKindSheet('mixer', 'full');
    setTab('score');
    expect(getKindSnap('mixer')).toBe('closed');
  });

  it('setTab(step) opens step sheet at full', async () => {
    const { setTab, getKindSnap, getActiveTab } = await import('./uiState');
    setTab('step');
    expect(getActiveTab()).toBe('step');
    expect(getKindSnap('step')).toBe('full');
  });

  it('setTab(piano) opens piano sheet at full', async () => {
    const { setTab, getKindSnap } = await import('./uiState');
    setTab('piano');
    expect(getKindSnap('piano')).toBe('full');
  });
});

// =========================================================================
// wavecode-mobile-split-pane — sheetHeightPx + persistence
// =========================================================================

describe('uiState sheetHeightPx (mobile split-pane drag-resize)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it('defaults to null (snap-driven)', async () => {
    const s = await import('./uiState');
    expect(s.getSheetHeightPx()).toBeNull();
  });

  it('setSheetHeightPx clamps below min to SHEET_HEIGHT_MIN_PX', async () => {
    const s = await import('./uiState');
    s.setSheetHeightPx(100);
    expect(s.getSheetHeightPx()).toBe(s.SHEET_HEIGHT_MIN_PX);
  });

  it('setSheetHeightPx clamps above max to SHEET_HEIGHT_MAX_PX', async () => {
    const s = await import('./uiState');
    s.setSheetHeightPx(9999);
    expect(s.getSheetHeightPx()).toBe(s.SHEET_HEIGHT_MAX_PX);
  });

  it('setSheetHeightPx accepts mid-range values verbatim', async () => {
    const s = await import('./uiState');
    s.setSheetHeightPx(420);
    expect(s.getSheetHeightPx()).toBe(420);
  });

  it('setSheetHeightPx persists to localStorage wavecode-mobile-sheet-h-v1', async () => {
    const s = await import('./uiState');
    s.setSheetHeightPx(380);
    expect(localStorage.getItem('wavecode-mobile-sheet-h-v1')).toBe('380');
  });

  it('resetSheetHeightPx clears the signal + localStorage entry', async () => {
    const s = await import('./uiState');
    s.setSheetHeightPx(380);
    expect(s.getSheetHeightPx()).toBe(380);
    s.resetSheetHeightPx();
    expect(s.getSheetHeightPx()).toBeNull();
    expect(localStorage.getItem('wavecode-mobile-sheet-h-v1')).toBeNull();
  });

  it('loadStoredSheetHeight restores from localStorage on module init', async () => {
    localStorage.setItem('wavecode-mobile-sheet-h-v1', '340');
    vi.resetModules();
    const s = await import('./uiState');
    expect(s.getSheetHeightPx()).toBe(340);
  });

  it('loadStoredSheetHeight ignores out-of-range persisted values', async () => {
    localStorage.setItem('wavecode-mobile-sheet-h-v1', '999999');
    vi.resetModules();
    const s = await import('./uiState');
    expect(s.getSheetHeightPx()).toBeNull();
  });

  it('setSheetHeightPx updates the --sheet-h CSS variable on documentElement', async () => {
    const s = await import('./uiState');
    s.setSheetHeightPx(400);
    // give the createEffect a tick to run
    await new Promise<void>((r) => setTimeout(r, 0));
    const v = document.documentElement.style.getPropertyValue('--sheet-h');
    expect(v).toBe('400px');
  });

  it('resetSheetHeightPx removes the --sheet-h CSS variable', async () => {
    const s = await import('./uiState');
    s.setSheetHeightPx(400);
    await new Promise<void>((r) => setTimeout(r, 0));
    expect(document.documentElement.style.getPropertyValue('--sheet-h')).toBe('400px');
    s.resetSheetHeightPx();
    await new Promise<void>((r) => setTimeout(r, 0));
    expect(document.documentElement.style.getPropertyValue('--sheet-h')).toBe('');
  });
});

describe('uiState keyboard shortcuts (multi-undo)', () => {
  let originalAdd: typeof window.addEventListener;
  let originalRemove: typeof window.removeEventListener;
  let undoMock: ReturnType<typeof vi.fn>;
  let redoMock: ReturnType<typeof vi.fn>;

  const captureHandler = (): void => {
    const origAdd = originalAdd.bind(window);
    window.addEventListener = ((event: string, handler: EventListenerOrEventListenerObject) => {
      if (event === 'keydown' && typeof handler === 'function') {
        (window as unknown as { __keydownHandler: (e: KeyboardEvent) => void }).__keydownHandler =
          handler as (e: KeyboardEvent) => void;
      }
      return origAdd(event, handler);
    }) as typeof window.addEventListener;
  };

  const fire = (init: KeyboardEventInit, target?: EventTarget | null): void => {
    const handler = (window as unknown as { __keydownHandler?: (e: KeyboardEvent) => void })
      .__keydownHandler;
    if (!handler) throw new Error('keydown handler not captured');
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    if (target) Object.defineProperty(event, 'target', { value: target, configurable: true });
    handler(event);
  };

  const focusOn = (el: HTMLElement): HTMLElement => {
    document.body.appendChild(el);
    return el;
  };

  beforeEach(async () => {
    localStorage.clear();
    vi.resetModules();
    originalAdd = window.addEventListener;
    originalRemove = window.removeEventListener;
    captureHandler();
    undoMock = vi.fn();
    redoMock = vi.fn();
    const mod = await import('./uiState');
    mod.installKeyboardShortcuts({
      focusAI: vi.fn(),
      focusScore: vi.fn(),
      undoScore: undoMock,
      redoScore: redoMock,
    });
  });

  afterEach(() => {
    window.addEventListener = originalAdd;
    window.removeEventListener = originalRemove;
    delete (window as unknown as { __keydownHandler?: unknown }).__keydownHandler;
    document.body.innerHTML = '';
  });

  it('Ctrl+Z (no shift) outside text fields triggers undoScore', () => {
    const target = focusOn(document.createElement('div'));
    fire({ key: 'z', ctrlKey: true }, target);
    expect(undoMock).toHaveBeenCalledTimes(1);
    expect(redoMock).not.toHaveBeenCalled();
  });

  it('Ctrl+Z is suppressed when focus is inside a textarea (lets native text-undo work)', () => {
    const ta = document.createElement('textarea');
    focusOn(ta);
    fire({ key: 'z', ctrlKey: true }, ta);
    expect(undoMock).not.toHaveBeenCalled();
  });

  it('Ctrl+Z is suppressed when focus is inside an input (not checkbox/radio)', () => {
    const input = document.createElement('input');
    input.type = 'text';
    focusOn(input);
    fire({ key: 'z', ctrlKey: true }, input);
    expect(undoMock).not.toHaveBeenCalled();
  });

  it('Ctrl+Z IS triggered when focus is on a checkbox (non-text input)', () => {
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    focusOn(cb);
    fire({ key: 'z', ctrlKey: true }, cb);
    expect(undoMock).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+Y triggers redoScore (no shift)', () => {
    const target = focusOn(document.createElement('div'));
    fire({ key: 'y', ctrlKey: true }, target);
    expect(redoMock).toHaveBeenCalledTimes(1);
    expect(undoMock).not.toHaveBeenCalled();
  });

  it('Ctrl+Shift+Z triggers redoScore (macOS convention)', () => {
    const target = focusOn(document.createElement('div'));
    fire({ key: 'z', ctrlKey: true, shiftKey: true }, target);
    expect(redoMock).toHaveBeenCalledTimes(1);
    expect(undoMock).not.toHaveBeenCalled();
  });

  it('plain key (no Ctrl/Meta) is ignored', () => {
    const target = focusOn(document.createElement('div'));
    fire({ key: 'z' }, target);
    expect(undoMock).not.toHaveBeenCalled();
    expect(redoMock).not.toHaveBeenCalled();
  });

  it('Meta+Z (macOS Cmd+Z) is treated as Ctrl+Z (undo)', () => {
    const target = focusOn(document.createElement('div'));
    fire({ key: 'z', metaKey: true }, target);
    expect(undoMock).toHaveBeenCalledTimes(1);
  });
});
