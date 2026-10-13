import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@solidjs/testing-library';
import { Toast } from './Toast';
import { consoleStore } from './consoleStore';

/**
 * Render the Toast under a fresh store. The store is reset in beforeEach
 * so tests don't leak toasts or unread counters.
 */

describe('Toast', () => {
  beforeEach(() => consoleStore.reset());
  afterEach(() => cleanup());

  it('renders nothing when there are no toasts', () => {
    const { container } = render(() => <Toast />);
    const stack = container.querySelector('.toast-stack');
    expect(stack).toBeTruthy();
    expect(stack!.querySelectorAll('.toast-item')).toHaveLength(0);
  });

  it('renders one toast per push', () => {
    consoleStore.pushToast({ severity: 'info', title: 'one' });
    consoleStore.pushToast({ severity: 'warn', title: 'two' });
    const { container } = render(() => <Toast />);
    const items = container.querySelectorAll('.toast-item');
    expect(items).toHaveLength(2);
    const titles = Array.from(items).map((n) => n.querySelector('.toast-title')?.textContent);
    expect(titles).toEqual(['one', 'two']);
  });

  it('click on the close button dismisses a toast', () => {
    consoleStore.pushToast({ severity: 'info', title: 'closable' });
    const { container } = render(() => <Toast />);
    expect(container.querySelectorAll('.toast-item')).toHaveLength(1);
    const closeBtn = container.querySelector('.toast-close') as HTMLButtonElement;
    fireEvent.click(closeBtn);
    expect(consoleStore.toasts()).toHaveLength(0);
    expect(container.querySelectorAll('.toast-item')).toHaveLength(0);
  });

  it('click on an error toast opens console + dismisses', () => {
    consoleStore.pushToast({ severity: 'error', title: 'oh no', source: 'X' });
    const { container } = render(() => <Toast />);
    const item = container.querySelector('.toast-item') as HTMLElement;
    fireEvent.click(item);
    expect(consoleStore.consoleOpen()).toBe(true);
    expect(consoleStore.toasts()).toHaveLength(0);
  });

  it('click on an info toast does NOT open console', () => {
    consoleStore.pushToast({ severity: 'info', title: 'informational' });
    const { container } = render(() => <Toast />);
    const item = container.querySelector('.toast-item') as HTMLElement;
    fireEvent.click(item);
    expect(consoleStore.consoleOpen()).toBe(false);
    // Info toast is still there (no dismissal on click).
    expect(consoleStore.toasts()).toHaveLength(1);
  });

  it('critical toast is sticky (no auto-dismiss timer)', () => {
    consoleStore.pushToast({ severity: 'critical', title: 'nuclear' });
    const { container } = render(() => <Toast />);
    const item = container.querySelector('.toast-item') as HTMLElement;
    // sticky icon visible
    expect(item.querySelector('.toast-pin')).toBeTruthy();
    // store TTL=0
    const list = consoleStore.toasts();
    expect(list[0]?.ttlMs).toBe(0);
  });

  it('renders a SVG severity icon inside .toast-icon (color-blind support)', () => {
    consoleStore.pushToast({ severity: 'info', title: 'i' });
    consoleStore.pushToast({ severity: 'warn', title: 'w' });
    consoleStore.pushToast({ severity: 'error', title: 'e' });
    consoleStore.pushToast({ severity: 'critical', title: 'c' });
    const { container } = render(() => <Toast />);
    const items = container.querySelectorAll('.toast-item');
    // Each toast's .toast-icon must host exactly one <svg> (severity icon).
    items.forEach((item) => {
      const slot = item.querySelector('.toast-icon');
      expect(slot).toBeTruthy();
      const svgs = slot!.querySelectorAll('svg');
      expect(svgs).toHaveLength(1);
    });
    // Critical toast also gets the toast-pin (sticky marker, kept).
    expect(items[3]?.querySelector('.toast-pin')).toBeTruthy();
  });

  it('fatal severity reuses the critical icon (treated equal for visuals)', () => {
    consoleStore.pushToast({ severity: 'critical', title: 'c' });
    consoleStore.pushToast({ severity: 'fatal', title: 'f' });
    const { container } = render(() => <Toast />);
    const items = container.querySelectorAll('.toast-item');
    expect(items).toHaveLength(2);
    // Both toast-icon slots host identical SVG path data (same icon).
    const iconA = items[0]!.querySelector('.toast-icon svg')!.innerHTML.replace(/\s+/g, '');
    const iconB = items[1]!.querySelector('.toast-icon svg')!.innerHTML.replace(/\s+/g, '');
    expect(iconA).toBe(iconB);
    // And fatal gets the sticky pin (TTL=0).
    expect(items[1]!.querySelector('.toast-pin')).toBeTruthy();
    expect(consoleStore.toasts()[1]?.ttlMs).toBe(0);
  });
});
