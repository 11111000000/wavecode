import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@solidjs/testing-library';
import { ConsoleSheet } from './ConsoleSheet';
import { consoleStore } from './consoleStore';
import type * as ConsoleStoreMod from './consoleStore';
import type * as LoggerMod from '~/infrastructure/log';

/**
 * The component tries `import('~/infrastructure/log')` at module-load time.
 * In the test environment that path doesn't resolve, so the fallback
 * (empty buffer / empty sheet) is the natural state.
 *
 * Tests for tab-switching + copy/clear rely on the fallback: the buttons
 * still work, they just operate on an empty buffer. Real-data tests live
 * with the logger once it's installed in production.
 *
 * Phase 3 — Subagent 13 added a second `describe` block below that
 * mocks `~/infrastructure/log` with `vi.mock`. The factory is hoisted
 * to the top of the file by vitest. To keep the original "fallback"
 * describe block working (where the dynamic import appears to fail),
 * the factory's `install()`/`setSink()` THROW when
 * `mockState.fallbackMode` is true (the initial value). The new
 * "persisted-errors restore" describe block flips the flag to false
 * and re-imports ConsoleSheet with `vi.resetModules()` so the IIFE
 * sees a non-throwing install and `hasLogger` becomes true.
 */

describe('ConsoleSheet (fallback: no logger module)', () => {
  beforeEach(() => {
    consoleStore.reset();
  });
  afterEach(() => cleanup());

  it('renders nothing when console is closed', () => {
    const { queryByTestId } = render(() => <ConsoleSheet />);
    expect(queryByTestId('console-body')).toBeNull();
  });

  it('renders when consoleOpen is true', () => {
    consoleStore.setConsoleOpen(true);
    const { getByTestId, queryByTestId } = render(() => <ConsoleSheet />);
    expect(getByTestId('console-body')).toBeTruthy();
    // When logger is absent, the warning is shown.
    expect(queryByTestId('console-empty-warning')).toBeTruthy();
  });

  it('tabs switch active tab', () => {
    consoleStore.setConsoleOpen(true);
    const { container, getByText } = render(() => <ConsoleSheet />);
    const errorsBtn = getByText(/^Errors \(/) as HTMLButtonElement;
    const allBtn = getByText('All logs') as HTMLButtonElement;
    const bySourceBtn = getByText('By source') as HTMLButtonElement;

    expect(errorsBtn.getAttribute('aria-selected')).toBe('true');
    expect(allBtn.getAttribute('aria-selected')).toBe('false');

    fireEvent.click(allBtn);
    expect(allBtn.getAttribute('aria-selected')).toBe('true');
    expect(errorsBtn.getAttribute('aria-selected')).toBe('false');

    fireEvent.click(bySourceBtn);
    expect(bySourceBtn.getAttribute('aria-selected')).toBe('true');
    expect(allBtn.getAttribute('aria-selected')).toBe('false');

    // count is shown as "0 entries · 0 errors" (logger missing → empty buf)
    expect(container.textContent).toMatch(/0 entries · 0 errors/);
  });

  it('copy button works without a logger (writes empty string)', async () => {
    consoleStore.setConsoleOpen(true);
    const writeText = vi.fn(async (_text: string) => undefined);
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { clipboard: { writeText } },
    });
    const { getByTestId } = render(() => <ConsoleSheet />);
    fireEvent.click(getByTestId('console-copy-btn'));
    await Promise.resolve();
    expect(writeText).toHaveBeenCalled();
    expect(writeText.mock.calls[0]?.[0]).toBe('');
  });

  it('clear button works without throwing', () => {
    consoleStore.setConsoleOpen(true);
    const { getByTestId } = render(() => <ConsoleSheet />);
    expect(() => fireEvent.click(getByTestId('console-clear-btn'))).not.toThrow();
  });

  it('close button closes the console', () => {
    consoleStore.setConsoleOpen(true);
    const { queryByLabelText, getByTestId } = render(() => <ConsoleSheet />);
    expect(getByTestId('console-body')).toBeTruthy();
    const close = queryByLabelText('Close console') as HTMLButtonElement;
    fireEvent.click(close);
    expect(consoleStore.consoleOpen()).toBe(false);
  });

  it('snap button toggles mid ↔ full', () => {
    consoleStore.setConsoleOpen(true);
    const { container } = render(() => <ConsoleSheet />);
    const sheet = container.querySelector('.console-sheet') as HTMLElement;
    expect(sheet.getAttribute('data-snap')).toBe('mid');
    const snapBtn = container.querySelector('.console-snap-btn') as HTMLButtonElement;
    fireEvent.click(snapBtn);
    expect(sheet.getAttribute('data-snap')).toBe('full');
    fireEvent.click(snapBtn);
    expect(sheet.getAttribute('data-snap')).toBe('mid');
  });

  it('backdrop click closes the console', () => {
    consoleStore.setConsoleOpen(true);
    const { container } = render(() => <ConsoleSheet />);
    expect(consoleStore.consoleOpen()).toBe(true);
    const backdrop = container.querySelector('.console-backdrop') as HTMLElement;
    fireEvent.click(backdrop);
    expect(consoleStore.consoleOpen()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Phase 3 — Subagent 13 — persisted-errors restore.
//
// We mock `~/infrastructure/log` so the dynamic import inside
// ConsoleSheet.tsx resolves to a controllable module. The factory is
// hoisted by vitest to the very top of this file.
//
// The mock's `install()` / `setSink()` THROW while
// `mockState.fallbackMode` is true (default). That keeps the
// "fallback" describe block above working as if the dynamic import
// had rejected. The "persisted-errors restore" describe block below
// flips the flag and re-imports ConsoleSheet (via
// `vi.resetModules()` + dynamic import) so the IIFE sees a
// non-throwing install and `hasLogger` becomes true.
// ---------------------------------------------------------------------------

const mockState = vi.hoisted(() => ({
  fallbackMode: true,
  entries: [] as ReadonlyArray<{
    readonly id: number;
    readonly level: string;
    readonly text: string;
    readonly source: string;
    readonly ts: number;
  }>,
  sink: null as ((e: { readonly id: number }) => void) | null,
}));

vi.mock('~/infrastructure/log', () => ({
  logger: {
    install: (): void => {
      if (mockState.fallbackMode) throw new Error('fallback mode');
    },
    setSink: (cb: ((e: { readonly id: number }) => void) | null): void => {
      if (mockState.fallbackMode) throw new Error('fallback mode');
      mockState.sink = cb;
    },
    getBuffer: (): readonly unknown[] =>
      Object.freeze(mockState.entries.slice()),
    clear: (): void => {
      mockState.entries = [];
    },
    loadPersistedErrors: vi.fn(
      async (): Promise<readonly unknown[]> => [],
    ),
    prepend: (entries: readonly unknown[]): void => {
      mockState.entries = [
        ...(entries as typeof mockState.entries),
        ...mockState.entries,
      ];
      if (mockState.sink) {
        try {
          mockState.sink(
            entries[entries.length - 1] as { readonly id: number },
          );
        } catch {
          /* mirror real logger's contract */
        }
      }
    },
  },
}));

describe('ConsoleSheet (persisted-errors restore)', () => {
  // Re-imported ConsoleSheet whose IIFE ran with fallbackMode=false.
  // Also re-import consoleStore: after `vi.resetModules()` the
  // re-imported ConsoleSheet module captures its own consoleStore
  // singleton, so we must use the SAME instance here (the top-level
  // `consoleStore` import refers to the pre-reset one).
  let CS: typeof ConsoleSheet;
  let mod: typeof LoggerMod;
  let store: typeof ConsoleStoreMod.consoleStore;

  beforeAll(async () => {
    mockState.fallbackMode = false;
    mockState.entries = [];
    mockState.sink = null;
    vi.resetModules();
    const csMod = await import('./ConsoleSheet');
    CS = csMod.ConsoleSheet;
    mod = await import('~/infrastructure/log');
    const storeMod = await import('./consoleStore');
    store = storeMod.consoleStore;
    // Wait for the re-imported ConsoleSheet's IIFE to finish
    // (install() + setSink() + sinkTickSet()). The IIFE is async
    // and may still be in flight when `await import(...)` returns.
    // Poll for the sink to be wired up — once setSink has run, the
    // IIFE has completed.
    for (let i = 0; i < 50 && !mockState.sink; i++) {
      await new Promise((r) => setTimeout(r, 5));
    }
    vi.mocked(mod.logger.loadPersistedErrors).mockReset();
    vi.mocked(mod.logger.loadPersistedErrors).mockImplementation(
      async () => [],
    );
  });

  beforeEach(() => {
    store.reset();
    mockState.entries = [];
    // Force the module-level `readBuffer` memo (created in the
    // re-imported ConsoleSheet) to re-evaluate. The memo caches
    // its previous return value across renders, so without a
    // sinkTick bump it would keep returning test-1's slice even
    // after we cleared `mockState.entries`. Bumping the sink
    // (which the production logger does after every push/prepend)
    // invalidates the memo and re-reads the now-empty buffer.
    if (mockState.sink) mockState.sink({ id: -1 });
    vi.mocked(mod.logger.loadPersistedErrors).mockReset();
    vi.mocked(mod.logger.loadPersistedErrors).mockImplementation(
      async () => [],
    );
  });

  afterEach(() => cleanup());

  it('renders persisted errors from IDB on mount (calls prepend with the loaded slice)', async () => {
    const persisted: ReadonlyArray<{
      readonly id: number;
      readonly level: 'error' | 'warn' | 'info' | 'debug' | 'fatal';
      readonly text: string;
      readonly args: readonly unknown[];
      readonly source: string;
      readonly ts: number;
    }> = [
      {
        id: 9001,
        level: 'error',
        text: 'persisted-one',
        args: ['persisted-one'],
        source: 'app',
        ts: 100,
      },
      {
        id: 9002,
        level: 'error',
        text: 'persisted-two',
        args: ['persisted-two'],
        source: 'app',
        ts: 200,
      },
    ];
    vi.mocked(mod.logger.loadPersistedErrors).mockResolvedValueOnce(persisted);

    store.setConsoleOpen(true);
    const { container, getByTestId } = render(() => <CS />);
    // Wait for the onMount async chain (loadPersistedErrors + prepend + sinkTick bump).
    await waitFor(() => {
      const counts = container.querySelector('.console-counts')?.textContent ?? '';
      expect(counts).toMatch(/2 entries · 2 errors/);
    });

    // The errors tab (default) should show both restored entries.
    const errorEntries = container.querySelectorAll('.console-entry-error');
    expect(errorEntries).toHaveLength(2);
    expect(container.textContent).toContain('persisted-one');
    expect(container.textContent).toContain('persisted-two');
    // No "logger missing" warning — the module was mocked successfully.
    expect(container.querySelector('[data-testid="console-empty-warning"]')).toBeNull();
    expect(getByTestId('console-body')).toBeTruthy();
    // prepend was called with the loaded slice.
    expect(mockState.entries.map((e) => e.text)).toEqual([
      'persisted-one',
      'persisted-two',
    ]);
  });

  it('does not call prepend when loadPersistedErrors returns []', async () => {
    vi.mocked(mod.logger.loadPersistedErrors).mockResolvedValueOnce([]);

    store.setConsoleOpen(true);
    const { container } = render(() => <CS />);
    // Flush microtasks before asserting.
    await new Promise((r) => setTimeout(r, 20));
    // The sheet renders with the mocked logger installed, so no
    // "logger missing" warning. Counts are zero.
    expect(container.querySelector('[data-testid="console-empty-warning"]')).toBeNull();
    expect(container.textContent).toMatch(/0 entries · 0 errors/);
    // Buffer stays empty.
    expect(mockState.entries).toHaveLength(0);
  });

  it('does not crash when loadPersistedErrors rejects', async () => {
    vi.mocked(mod.logger.loadPersistedErrors).mockRejectedValueOnce(
      new Error('IDB unavailable'),
    );

    store.setConsoleOpen(true);
    const { container } = render(() => <CS />);
    // Let the microtask queue drain (rejection + catch path).
    await new Promise((r) => setTimeout(r, 20));
    // No "logger missing" warning, body still renders, no errors
    // surfaced in the sheet.
    expect(container.querySelector('[data-testid="console-empty-warning"]')).toBeNull();
    expect(container.querySelector('[data-testid="console-body"]')).toBeTruthy();
    // Counts are zero — prepend was never called.
    expect(container.textContent).toMatch(/0 entries · 0 errors/);
    // The warn swallowed the rejection — sheet stays open, no crash.
    expect(store.consoleOpen()).toBe(true);
    expect(mockState.entries).toHaveLength(0);
  });
});
