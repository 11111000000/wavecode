import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@solidjs/testing-library';
import { ConsoleSheet } from './ConsoleSheet';
import { consoleStore } from './consoleStore';
import { logger } from '~/infrastructure/log';

/**
 * Logger is statically imported and installed at boot in production
 * (see `main.tsx`). For the unit-test environment there's no boot path,
 * so we use the real logger module directly: `logger.push(...)` lands
 * entries in the same ring buffer the sheet reads from via
 * `safeReadBuffer → logger.getBuffer()`. `logger.clear()` in beforeEach
 * gives every test a clean slate.
 *
 * Two describe blocks:
 *  - 'ConsoleSheet (graceful fallback: ...)' — uses the real logger
 *    and spies on `logger.getBuffer` to make it throw, verifying
 *    the sheet's try/catch safety net.
 *  - 'ConsoleSheet (persisted-errors restore)' — mocks the logger
 *    module with `vi.mock` so the prepend behavior on mount can be
 *    controlled. The mock factory is hoisted to the top of this file
 *    by vitest; the static-import tests above are unaffected because
 *    they use the real (unmocked) logger via the static import.
 */

describe('ConsoleSheet', () => {
  beforeEach(() => {
    consoleStore.reset();
    logger.clear();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders nothing when console is closed', () => {
    const { queryByTestId } = render(() => <ConsoleSheet />);
    expect(queryByTestId('console-body')).toBeNull();
  });

  it('renders when consoleOpen is true', () => {
    consoleStore.setConsoleOpen(true);
    const { getByTestId, queryByTestId } = render(() => <ConsoleSheet />);
    expect(getByTestId('console-body')).toBeTruthy();
    // Logger is statically imported now — the empty-buffer warning is gone.
    expect(queryByTestId('console-empty-warning')).toBeNull();
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

    // count is shown as "0 entries · 0 errors" (fresh buffer)
    expect(container.textContent).toMatch(/0 entries · 0 errors/);
  });

  it('copy button writes empty string when buffer is empty', async () => {
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

describe('ConsoleSheet (graceful fallback: logger.getBuffer throws)', () => {
  beforeEach(() => {
    consoleStore.reset();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders without crashing when getBuffer throws', () => {
    // Simulate a degraded logger module — getBuffer blows up. The
    // sheet's `safeReadBuffer` catches it and falls back to [].
    vi.spyOn(logger, 'getBuffer').mockImplementation(() => {
      throw new Error('mock logger unavailable');
    });
    consoleStore.setConsoleOpen(true);
    const { container, getByTestId } = render(() => <ConsoleSheet />);
    expect(getByTestId('console-body')).toBeTruthy();
    // Empty fallback buffer → zero counts.
    expect(container.textContent).toMatch(/0 entries · 0 errors/);
  });

  it('clear button does not propagate logger.clear errors', () => {
    vi.spyOn(logger, 'getBuffer').mockImplementation(() => {
      throw new Error('mock logger unavailable');
    });
    vi.spyOn(logger, 'clear').mockImplementation(() => {
      throw new Error('mock clear failure');
    });
    consoleStore.setConsoleOpen(true);
    const { getByTestId } = render(() => <ConsoleSheet />);
    expect(() => fireEvent.click(getByTestId('console-clear-btn'))).not.toThrow();
  });
});

describe('ConsoleSheet (static import path: real logger, populated buffer)', () => {
  beforeEach(() => {
    consoleStore.reset();
    logger.clear();
  });
  afterEach(() => {
    cleanup();
    logger.clear();
  });

  it('shows entries that were pushed into the buffer before render', () => {
    logger.push('info', ['hello from test'], 'app');
    consoleStore.setConsoleOpen(true);
    const { container, getByText } = render(() => <ConsoleSheet />);

    // "Errors" tab is active by default and this entry is 'info', so it
    // would not appear there. Switch to "All logs" to verify it shows up.
    fireEvent.click(getByText('All logs'));
    expect(container.textContent).toContain('hello from test');
    expect(container.textContent).toMatch(/1 entries · 0 errors/);
  });

  it('errors filter surfaces error and warn levels, hides info', () => {
    logger.push('info', ['should-not-appear'], 'app');
    logger.push('warn', ['careful'], 'app');
    logger.push('error', ['boom'], 'app');
    consoleStore.setConsoleOpen(true);
    const { container } = render(() => <ConsoleSheet />);

    // Errors tab is the default; counters should count all three.
    expect(container.textContent).toMatch(/3 entries · 1 errors/);
    // Body should contain warn + error texts but not the info one.
    expect(container.textContent).toContain('careful');
    expect(container.textContent).toContain('boom');
    expect(container.textContent).not.toContain('should-not-appear');
  });

  it('counts update when new entries are pushed after mount', () => {
    // beforeEach already called logger.clear(); the buffer is empty
    // (verified here at the logger level — the sheet's memo wouldn't
    // re-read on clear() since clear doesn't fire the sink, so we
    // check the buffer directly instead of via JSX).
    expect(logger.getBuffer()).toEqual([]);

    consoleStore.setConsoleOpen(true);
    const { container } = render(() => <ConsoleSheet />);

    // Push directly into the buffer; the registered sink fires
    // synchronously inside pushEntry, sinkTick increments, the memo
    // re-runs on the next read, and the JSX reflects the new entry.
    logger.push('error', ['delayed'], 'app');
    expect(container.textContent).toMatch(/1 entries · 1 errors/);
  });
});
