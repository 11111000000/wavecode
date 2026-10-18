import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@solidjs/testing-library';

// SampleLoader pulls in @kabelsalat/web + Strudel at module-load — those
// imports break under jsdom without the WebAudio polyfill. Mock it
// wholesale so Admin.tsx's runtime lookup of getSampleLoadProgress
// resolves to a local stub. vi.mock is hoisted by vitest before any
// import below runs.
vi.mock('~/infrastructure/audio/SampleLoader', () => {
  const defaultProgress = {
    loaded: 0,
    total: 0,
    perBank: {
      piano: { loaded: 0, total: 0 },
      drums: { loaded: 0, total: 0 },
      synth: { loaded: 0, total: 0 },
    },
  };
  return {
    getSampleLoadProgress: () => defaultProgress,
    __resetForTests: () => undefined,
  };
});

import { Admin } from './Admin';
import { consoleStore } from '~/presentation/components/consoleStore';
import { logger, type LogEntry } from '~/infrastructure/log';
import * as SampleLoaderMod from '~/infrastructure/audio/SampleLoader';

/**
 * Admin — debug inspector tests.
 *
 * Strategy
 * --------
 *  - Use the live `logger` module (installed via static import elsewhere).
 *    `logger.clear()` in beforeEach gives every test a clean buffer;
 *    `logger.push(...)` populates known entries we can assert on.
 *  - `consoleStore` is also a live module — `consoleStore.reset()` in
 *    beforeEach zeroes toasts / unreadErrors / consoleOpen.
 *  - Audio context: jsdom doesn't provide AudioContext, so we stub
 *    `window.__wavecodeAudioCtx` per-test via a typed helper.
 *  - SampleLoader has cross-test state (singleton modules). We use the
 *    test-only `__resetForTests` from `SampleLoader` where available,
 *    otherwise rely on the static `getSampleLoadProgress` getter which
 *    reads module state.
 *
 * The route hash isn't relevant here — Admin is the page component and
 * is rendered directly. Hash routing is tested separately via the App
 * smoke (not in this file — page component scope only; hash routing is
 * tested separately in app-level e2e).
 */

const stubAudioCtx = (overrides: Partial<AudioContext> | null): void => {
  const g = window as unknown as { __wavecodeAudioCtx?: AudioContext };
  if (overrides === null) {
    delete g.__wavecodeAudioCtx;
    return;
  }
  g.__wavecodeAudioCtx = {
    state: 'running',
    sampleRate: 48000,
    currentTime: 0,
    ...overrides,
  } as AudioContext;
};

const stubPiano = (value: { active?: number; source?: string | null } | null): void => {
  const g = window as unknown as {
    __wavecodePiano?: { active?: number; source?: string | null };
  };
  if (value === null) {
    delete g.__wavecodePiano;
    return;
  }
  g.__wavecodePiano = value;
};

describe('Admin', () => {
  beforeEach(() => {
    consoleStore.reset();
    logger.clear();
    stubAudioCtx(null);
    stubPiano(null);
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    stubAudioCtx(null);
    stubPiano(null);
  });

  it('renders all 6 sections (logger / console / persisted / audio / samples / piano)', () => {
    const { getByTestId } = render(() => <Admin />);
    expect(getByTestId('admin-section-logger')).toBeTruthy();
    expect(getByTestId('admin-section-console')).toBeTruthy();
    expect(getByTestId('admin-section-persisted')).toBeTruthy();
    expect(getByTestId('admin-section-audio')).toBeTruthy();
    expect(getByTestId('admin-section-samples')).toBeTruthy();
    expect(getByTestId('admin-section-piano')).toBeTruthy();
  });

  it('logger section shows live entries pushed before mount', () => {
    logger.push('info', ['hello from boot'], 'app');
    logger.push('warn', ['careful'], 'strudel');
    const { container, getByTestId } = render(() => <Admin />);
    const list = getByTestId('logger-list');
    expect(list.textContent).toContain('hello from boot');
    expect(list.textContent).toContain('careful');
    expect(container.textContent).toMatch(/\[app\]/);
    expect(container.textContent).toMatch(/\[strudel\]/);
  });

  it('logger section count reflects the buffer size', () => {
    logger.push('info', ['a'], 'app');
    logger.push('info', ['b'], 'app');
    logger.push('info', ['c'], 'app');
    const { getByTestId } = render(() => <Admin />);
    expect(getByTestId('admin-section-count-logger').textContent).toBe('3');
  });

  it('filter dropdown narrows the buffer view by level', () => {
    logger.push('info', ['should-not-appear'], 'app');
    logger.push('error', ['boom'], 'app');
    const { getByTestId } = render(() => <Admin />);
    const select = getByTestId('filter-level') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'error' } });
    const list = getByTestId('logger-list');
    expect(list.textContent).toContain('boom');
    expect(list.textContent).not.toContain('should-not-appear');
    // Section count badge reflects the filtered view (1 = just 'boom').
    expect(getByTestId('admin-section-count-logger').textContent).toBe('1');
  });

  it('filter dropdown narrows the buffer view by source', () => {
    logger.push('info', ['from-strudel'], 'strudel');
    logger.push('info', ['from-sampler'], 'sampler');
    const { getByTestId } = render(() => <Admin />);
    const select = getByTestId('filter-source') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'sampler' } });
    const list = getByTestId('logger-list');
    expect(list.textContent).toContain('from-sampler');
    expect(list.textContent).not.toContain('from-strudel');
  });

  it('audio section shows current state from __wavecodeAudioCtx', () => {
    stubAudioCtx({
      state: 'running',
      sampleRate: 48000,
      currentTime: 12.345,
    });
    const { container } = render(() => <Admin />);
    expect(container.textContent).toContain('running');
    expect(container.textContent).toContain('48000');
    expect(container.textContent).toContain('12.345');
  });

  it('audio section shows "none" when no AudioContext has been created', () => {
    stubAudioCtx(null);
    const { container, getByTestId } = render(() => <Admin />);
    expect(container.textContent).toContain('none');
    // count badge should be 0 for "none"
    expect(getByTestId('admin-section-count-audio').textContent).toBe('0');
  });

  it('persisted errors section lists entries from loadPersistedErrors()', async () => {
    const persisted: LogEntry[] = [
      {
        id: 1, level: 'error', text: 'persisted-one',
        args: ['persisted-one'], source: 'app', ts: 1,
      },
      {
        id: 2, level: 'fatal', text: 'persisted-two',
        args: ['persisted-two'], source: 'webaudio', ts: 2,
      },
    ];
    vi.spyOn(logger, 'loadPersistedErrors').mockResolvedValue(persisted);
    const { getByTestId } = render(() => <Admin />);
    // loadPersistedErrors returns a Promise — flush the microtask queue
    // so the component re-renders with the slice.
    await Promise.resolve();
    await Promise.resolve();
    const list = getByTestId('persisted-list');
    expect(list.textContent).toContain('persisted-one');
    expect(list.textContent).toContain('persisted-two');
  });

  it('Clear button on persisted section re-fetches via loadPersistedErrors', async () => {
    const initial: LogEntry[] = [
      {
        id: 1, level: 'error', text: 'to-be-cleared',
        args: ['to-be-cleared'], source: 'app', ts: 1,
      },
    ];
    const cleared: readonly LogEntry[] = [];
    const loadSpy = vi
      .spyOn(logger, 'loadPersistedErrors')
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(cleared);
    const { getByTestId } = render(() => <Admin />);
    await Promise.resolve();
    await Promise.resolve();
    // Initial mount triggered loadPersistedErrors once.
    expect(loadSpy).toHaveBeenCalledTimes(1);
    expect(getByTestId('persisted-list').textContent).toContain('to-be-cleared');
    // Click Clear — Admin wires up:
    //   1. clearPersistedErrors() (best-effort, may no-op if IDB unavailable)
    //   2. refreshPersisted() → loadPersistedErrors() again
    // We verify #2 because it's the contractually-visible side.
    fireEvent.click(getByTestId('persisted-clear-btn'));
    // Allow the dynamic idb import + IDB-failure cascade to settle, then
    // the second loadPersistedErrors microtask.
    await new Promise((r) => setTimeout(r, 50));
    await Promise.resolve();
    await Promise.resolve();
    expect(loadSpy).toHaveBeenCalledTimes(2);
    // After refresh, the list should reflect the second mock return ([]).
    expect(getByTestId('persisted-list').textContent).not.toContain('to-be-cleared');
  });

  it('console section reflects live toasts', () => {
    consoleStore.pushToast({ severity: 'info', title: 'toast-A' });
    consoleStore.pushToast({ severity: 'error', title: 'toast-B' });
    const { getByTestId } = render(() => <Admin />);
    const list = getByTestId('console-toast-list');
    expect(list.textContent).toContain('toast-A');
    expect(list.textContent).toContain('toast-B');
    expect(getByTestId('admin-section-count-console').textContent).toBe('2');
  });

  it('sample section renders per-bank loaded/total counts', () => {
    // getSampleLoadProgress reads module state. Force a non-zero value
    // by stubbing it for the duration of this test.
    const spy = vi
      .spyOn(SampleLoaderMod, 'getSampleLoadProgress')
      .mockReturnValue({
        loaded: 7,
        total: 36,
        perBank: {
          piano: { loaded: 3, total: 12 },
          drums: { loaded: 2, total: 12 },
          synth: { loaded: 2, total: 12 },
        },
      });
    const { getByTestId } = render(() => <Admin />);
    const grid = getByTestId('sample-bank-grid');
    expect(grid.textContent).toContain('piano');
    expect(grid.textContent).toContain('drums');
    expect(grid.textContent).toContain('synth');
    expect(grid.textContent).toContain('3/12');
    expect(grid.textContent).toContain('2/12');
    spy.mockRestore();
  });

  it('piano section reads active notes and source from __wavecodePiano', () => {
    stubPiano({ active: 3, source: 'Arturia MiniLab' });
    const { container, getByTestId } = render(() => <Admin />);
    expect(container.textContent).toContain('3');
    expect(container.textContent).toContain('Arturia MiniLab');
    expect(getByTestId('admin-section-count-piano').textContent).toBe('3');
  });
});