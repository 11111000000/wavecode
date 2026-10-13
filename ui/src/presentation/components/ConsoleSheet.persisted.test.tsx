import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor } from '@solidjs/testing-library';
import { ConsoleSheet } from './ConsoleSheet';
import type * as ConsoleStoreMod from './consoleStore';
import type * as LoggerMod from '~/infrastructure/log';

/**
 * Phase 3 / Subagent 13 — persisted-errors restore.
 *
 * Split out from ConsoleSheet.test.tsx so the static-import tests in
 * that file can use the real logger (vi.mock would replace the
 * static import with a mock that has no `push` method, breaking
 * those tests).
 *
 * Strategy:
 *   1. vi.mock('~/infrastructure/log', ...) replaces the logger
 *      module with a controllable mock. The factory uses
 *      `mockState.fallbackMode` to decide whether `install()` throws
 *      (simulating a failed dynamic import — the original fallback
 *      path that Subagent 11's static-import refactor removed).
 *   2. vi.resetModules() in beforeAll discards the cached
 *      ConsoleSheet module so the re-imported one uses the mock
 *      we just registered.
 *   3. The re-imported ConsoleSheet calls `logger.setSink(...)` at
 *      top level (Subagent 11's static-import refactor). The mock
 *      makes setSink a no-op (no throw) so the module loads
 *      successfully.
 *   4. setSink's callback is stored in `mockState.sink` so the
 *      tests can manually trigger a sinkTick bump to invalidate
 *      the readBuffer memo.
 */

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
      // setSink is a top-level call from ConsoleSheet.tsx. It MUST
      // be a no-op in fallback mode or the module fails to load.
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
    // Wait for the re-imported ConsoleSheet's setSink to fire.
    for (let i = 0; i < 50 && !mockState.sink; i += 1) {
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
      { id: 9001, level: 'error', text: 'persisted-one', args: ['persisted-one'], source: 'app', ts: 100 },
      { id: 9002, level: 'error', text: 'persisted-two', args: ['persisted-two'], source: 'app', ts: 200 },
    ];
    vi.mocked(mod.logger.loadPersistedErrors).mockResolvedValueOnce(persisted);

    store.setConsoleOpen(true);
    const { container, getByTestId } = render(() => <CS />);
    await waitFor(() => {
      const counts = container.querySelector('.console-counts')?.textContent ?? '';
      expect(counts).toMatch(/2 entries · 2 errors/);
    });

    const errorEntries = container.querySelectorAll('.console-entry-error');
    expect(errorEntries).toHaveLength(2);
    expect(container.textContent).toContain('persisted-one');
    expect(container.textContent).toContain('persisted-two');
    expect(getByTestId('console-body')).toBeTruthy();
    expect(mockState.entries.map((e) => e.text)).toEqual([
      'persisted-one',
      'persisted-two',
    ]);
  });

  it('does not call prepend when loadPersistedErrors returns []', async () => {
    vi.mocked(mod.logger.loadPersistedErrors).mockResolvedValueOnce([]);

    store.setConsoleOpen(true);
    const { container } = render(() => <CS />);
    await new Promise((r) => setTimeout(r, 20));
    expect(container.textContent).toMatch(/0 entries · 0 errors/);
    expect(mockState.entries).toHaveLength(0);
  });

  it('does not crash when loadPersistedErrors rejects', async () => {
    vi.mocked(mod.logger.loadPersistedErrors).mockRejectedValueOnce(
      new Error('IDB unavailable'),
    );

    store.setConsoleOpen(true);
    const { container } = render(() => <CS />);
    await new Promise((r) => setTimeout(r, 20));
    expect(container.querySelector('[data-testid="console-body"]')).toBeTruthy();
    expect(container.textContent).toMatch(/0 entries · 0 errors/);
    expect(store.consoleOpen()).toBe(true);
    expect(mockState.entries).toHaveLength(0);
  });
});
