import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@solidjs/testing-library';
import { TransportBar } from './TransportBar';

const STORAGE_KEY = 'wavecode-mobile-transport-expanded-v1';

const renderBar = (
  overrides: Partial<Parameters<typeof TransportBar>[0]> = {},
): ReturnType<typeof render> => {
  const props = {
    presetId: 'creep',
    showSavePreset: false,
    newPresetName: '',
    audioRunning: () => false,
    audioStarting: () => false,
    onLoadPreset: vi.fn(),
    onShowSavePreset: vi.fn(),
    onNewPresetName: vi.fn(),
    onSavePreset: vi.fn(),
    onPlay: vi.fn(),
    onStop: vi.fn(),
    ...overrides,
  };
  return render(() => <TransportBar {...props} />);
};

const setMatchMedia = (matches: boolean): void => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: query === '(max-width: 720px)' ? matches : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
};

describe('TransportBar (math/wavecode-mobile-transport-bar)', () => {
  beforeEach(() => {
    localStorage.clear();
    setMatchMedia(true);
    document.querySelector('.app-body')?.removeAttribute('data-transport-collapsed');
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('default on mobile (max-width:720px) → collapsed: body hidden, data-collapsed="true"', () => {
    const { container } = renderBar();
    const bar = container.querySelector('[data-testid="transport-bar"]') as HTMLElement;
    expect(bar).toBeTruthy();
    expect(bar.getAttribute('data-collapsed')).toBe('true');
    expect(bar.getAttribute('data-mobile')).toBe('true');

    const body = container.querySelector('[data-testid="transport-bar-body"]') as HTMLElement;
    expect(body).toBeTruthy();
    // jsdom does not apply @media queries, so we cannot read computed
    // display here. The data-collapsed attribute is the source of
    // truth — CSS rule
    // .app-transport-bar[data-collapsed='true'] .app-transport-bar__body
    // { display: none } applies in real browsers and is verified
    // manually in math/wavecode-mobile-transport-bar browser test.
    expect(bar.getAttribute('data-collapsed')).toBe('true');

    const toggle = container.querySelector(
      '[data-testid="transport-bar-toggle"]',
    ) as HTMLButtonElement;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('default on desktop (matchMedia=false) → expanded: body visible, data-collapsed="false"', () => {
    setMatchMedia(false);
    const { container } = renderBar();
    const bar = container.querySelector('[data-testid="transport-bar"]') as HTMLElement;
    expect(bar.getAttribute('data-collapsed')).toBe('false');
    expect(bar.getAttribute('data-mobile')).toBe('false');
    // body is rendered; jsdom doesn't apply @media so we just check
    // data-collapsed="false" (the CSS hides body when data-collapsed
    // is "true").
  });

  it('click toggle → body becomes visible, data-collapsed="false", aria-expanded="true"', async () => {
    const { container } = renderBar();
    const toggle = container.querySelector(
      '[data-testid="transport-bar-toggle"]',
    ) as HTMLButtonElement;
    const bar = container.querySelector('[data-testid="transport-bar"]') as HTMLElement;

    expect(bar.getAttribute('data-collapsed')).toBe('true');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(toggle);

    await waitFor(() => {
      expect(bar.getAttribute('data-collapsed')).toBe('false');
    });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  it('toggle persists to localStorage on every click', () => {
    const { container } = renderBar();
    const toggle = container.querySelector(
      '[data-testid="transport-bar-toggle"]',
    ) as HTMLButtonElement;

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

    fireEvent.click(toggle);
    expect(localStorage.getItem(STORAGE_KEY)).toBe('true');

    fireEvent.click(toggle);
    expect(localStorage.getItem(STORAGE_KEY)).toBe('false');
  });

  it('reads stored preference on init: stored=true → expanded even on mobile', () => {
    localStorage.setItem(STORAGE_KEY, 'true');
    const { container } = renderBar();
    const bar = container.querySelector('[data-testid="transport-bar"]') as HTMLElement;
    expect(bar.getAttribute('data-collapsed')).toBe('false');
  });

  it('reads stored preference on init: stored=false → collapsed even on desktop', () => {
    localStorage.setItem(STORAGE_KEY, 'false');
    setMatchMedia(false);
    const { container } = renderBar();
    const bar = container.querySelector('[data-testid="transport-bar"]') as HTMLElement;
    expect(bar.getAttribute('data-collapsed')).toBe('true');
  });

  it('mirrors data-collapsed onto .app-body[data-transport-collapsed]', async () => {
    const appBody = document.createElement('div');
    appBody.className = 'app-body';
    document.body.appendChild(appBody);

    const { container } = renderBar();
    const toggle = container.querySelector(
      '[data-testid="transport-bar-toggle"]',
    ) as HTMLButtonElement;

    expect(appBody.getAttribute('data-transport-collapsed')).toBe('true');

    fireEvent.click(toggle);

    await waitFor(() => {
      expect(appBody.getAttribute('data-transport-collapsed')).toBe('false');
    });

    fireEvent.click(toggle);

    await waitFor(() => {
      expect(appBody.getAttribute('data-transport-collapsed')).toBe('true');
    });

    document.body.removeChild(appBody);
  });

  it('Play button is ALWAYS visible (in strip), even when collapsed', () => {
    const onPlay = vi.fn();
    const { container } = renderBar({ onPlay });
    const playBtn = container.querySelector(
      '[data-testid="transport-play-btn"]',
    ) as HTMLButtonElement;
    expect(playBtn).toBeTruthy();
    expect(playBtn.getAttribute('aria-label')).toBe('Запуск');
    fireEvent.click(playBtn);
    expect(onPlay).toHaveBeenCalledTimes(1);
  });

  it('Play button shows Stop state when audioRunning=true', () => {
    const onStop = vi.fn();
    const { container } = renderBar({
      audioRunning: () => true,
      onStop,
    });
    const playBtn = container.querySelector(
      '[data-testid="transport-play-btn"]',
    ) as HTMLButtonElement;
    expect(playBtn.getAttribute('aria-label')).toBe('Стоп');
    fireEvent.click(playBtn);
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('preset <select> is ALWAYS reachable in the strip (user request 2026-10-14)', () => {
    const onLoadPreset = vi.fn();
    const { container } = renderBar({ onLoadPreset });

    const select = container.querySelector('[data-testid="preset-select"]') as HTMLSelectElement;
    expect(select).toBeTruthy();
    // Preset lives in the strip — not in the expandable body. So it's
    // reachable WITHOUT clicking the toggle. Verify by selecting
    // without expanding.
    expect(select.closest('.app-transport-bar__body')).toBeNull();
    expect(select.closest('.app-transport-bar__strip')).toBeTruthy();

    // The select has the value "creep" (matches props.presetId); we
    // dispatch a change event simulating a different selection.
    select.value = 'fur-elise';
    fireEvent.change(select);
    expect(onLoadPreset).toHaveBeenCalled();
  });

  it('toggle body no longer contains preset (preset moved to strip)', () => {
    const { container } = renderBar();
    const toggle = container.querySelector(
      '[data-testid="transport-bar-toggle"]',
    ) as HTMLButtonElement;
    fireEvent.click(toggle); // expand

    const body = container.querySelector(
      '[data-testid="transport-bar-body"]',
    ) as HTMLElement;
    const selectInBody = body.querySelector('[data-testid="preset-select"]');
    expect(selectInBody).toBeNull();
  });

  it('renders without onPlay/onStop props (default noop) and does not throw', () => {
    expect(() => renderBar({
      onPlay: undefined as unknown as () => void,
      onStop: undefined as unknown as () => void,
    })).not.toThrow();
  });
});
