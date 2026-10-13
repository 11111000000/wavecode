import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@solidjs/testing-library';
import { ConsoleSheet } from './ConsoleSheet';
import { consoleStore } from './consoleStore';

/**
 * The component tries `import('~/infrastructure/log')` at module-load time.
 * In the test environment that path doesn't resolve, so the fallback
 * (empty buffer / empty sheet) is the natural state.
 *
 * Tests for tab-switching + copy/clear rely on the fallback: the buttons
 * still work, they just operate on an empty buffer. Real-data tests live
 * with the logger once it's installed in production.
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
