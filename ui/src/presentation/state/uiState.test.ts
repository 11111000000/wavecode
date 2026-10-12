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
});
