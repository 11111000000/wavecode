import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@solidjs/testing-library';
import { Toast } from './Toast';
import { consoleStore } from './consoleStore';

/**
 * Render the Toast under a fresh store. The store is reset in beforeEach
 * so tests don't leak toasts or unread counters.
 *
 * wavecode-zen-ui-phases-6-7 (фаза 6): тост в интерфейсе ОДИН —
 * самый свежий. Ошибки сюда не попадают вовсе: их показывает
 * регион ошибок внизу холста (ErrorRegion.tsx).
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

  it('renders ONE toast — the newest one (no stack)', () => {
    consoleStore.pushToast({ severity: 'info', title: 'one' });
    consoleStore.pushToast({ severity: 'warn', title: 'two' });
    const { container } = render(() => <Toast />);
    const items = container.querySelectorAll('.toast-item');
    expect(items).toHaveLength(1);
    const titles = Array.from(items).map((n) => n.querySelector('.toast-title')?.textContent);
    expect(titles).toEqual(['two']);
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

  it('errors do NOT render as toasts — they live in the error channel', () => {
    consoleStore.pushToast({ severity: 'error', title: 'oh no', source: 'X' });
    consoleStore.pushToast({ severity: 'critical', title: 'nuclear' });
    const { container } = render(() => <Toast />);
    expect(container.querySelectorAll('.toast-item')).toHaveLength(0);
    expect(consoleStore.errors()).toHaveLength(2);
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

  it('a pinned toast (ttlMs=0) shows the pin marker', () => {
    consoleStore.pushToast({ severity: 'info', title: 'pinned', ttlMs: 0 });
    const { container } = render(() => <Toast />);
    const item = container.querySelector('.toast-item') as HTMLElement;
    expect(item.querySelector('.toast-pin')).toBeTruthy();
    expect(consoleStore.toasts()[0]?.ttlMs).toBe(0);
  });

  it('renders a SVG severity icon inside .toast-icon (color-blind support)', () => {
    consoleStore.pushToast({ severity: 'info', title: 'i' });
    consoleStore.pushToast({ severity: 'warn', title: 'w' });
    const { container } = render(() => <Toast />);
    const items = container.querySelectorAll('.toast-item');
    // Each toast's .toast-icon must host exactly one <svg> (severity icon).
    items.forEach((item) => {
      const slot = item.querySelector('.toast-icon');
      expect(slot).toBeTruthy();
      const svgs = slot!.querySelectorAll('svg');
      expect(svgs).toHaveLength(1);
    });
  });

  it('warn and info use different icons', () => {
    consoleStore.pushToast({ severity: 'warn', title: 'w' });
    const { container } = render(() => <Toast />);
    const warnIcon = container.querySelector('.toast-icon svg')!.innerHTML.replace(/\s+/g, '');

    consoleStore.reset();
    consoleStore.pushToast({ severity: 'info', title: 'i' });
    const second = render(() => <Toast />);
    const infoIcon = second.container.querySelector('.toast-icon svg')!.innerHTML.replace(/\s+/g, '');
    expect(warnIcon).not.toBe(infoIcon);
  });
});
