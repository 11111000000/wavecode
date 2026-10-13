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
});
