import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@solidjs/testing-library';
import { ConsoleButton } from './ConsoleButton';
import { consoleStore } from './consoleStore';

describe('ConsoleButton', () => {
  beforeEach(() => consoleStore.reset());
  afterEach(() => cleanup());

  it('renders with no badge when there are no unread errors', () => {
    const { queryByTestId } = render(() => <ConsoleButton />);
    expect(queryByTestId('console-btn')).toBeTruthy();
    expect(queryByTestId('console-btn-badge')).toBeNull();
  });

  it('shows the badge with the unread-error count when > 0', () => {
    consoleStore.pushToast({ severity: 'error', title: 'e1' });
    consoleStore.pushToast({ severity: 'error', title: 'e2' });
    consoleStore.pushToast({ severity: 'error', title: 'e3' });
    const { getByTestId } = render(() => <ConsoleButton />);
    const badge = getByTestId('console-btn-badge');
    expect(badge.textContent).toBe('3');
  });

  it('cap badge text at 99+', () => {
    for (let i = 0; i < 150; i++) {
      consoleStore.pushToast({ severity: 'error', title: `e${i}` });
    }
    const { getByTestId } = render(() => <ConsoleButton />);
    const badge = getByTestId('console-btn-badge');
    expect(badge.textContent).toBe('99+');
  });

  it('applies the has-errors class when unreadErrors > 0', () => {
    consoleStore.pushToast({ severity: 'error', title: 'e' });
    const { getByTestId } = render(() => <ConsoleButton />);
    const btn = getByTestId('console-btn') as HTMLButtonElement;
    expect(btn.className).toContain('has-errors');
  });

  it('does NOT apply has-errors when only info/warn toasts', () => {
    consoleStore.pushToast({ severity: 'info', title: 'i' });
    consoleStore.pushToast({ severity: 'warn', title: 'w' });
    const { getByTestId } = render(() => <ConsoleButton />);
    const btn = getByTestId('console-btn') as HTMLButtonElement;
    expect(btn.className).not.toContain('has-errors');
  });

  it('clicking the button opens the console', () => {
    consoleStore.pushToast({ severity: 'error', title: 'e' });
    const { getByTestId } = render(() => <ConsoleButton />);
    const btn = getByTestId('console-btn') as HTMLButtonElement;
    expect(consoleStore.consoleOpen()).toBe(false);
    fireEvent.click(btn);
    expect(consoleStore.consoleOpen()).toBe(true);
  });

  it('opening the console via click also marks errors as read', () => {
    consoleStore.pushToast({ severity: 'error', title: 'e1' });
    consoleStore.pushToast({ severity: 'error', title: 'e2' });
    expect(consoleStore.unreadErrors()).toBe(2);
    const { getByTestId } = render(() => <ConsoleButton />);
    fireEvent.click(getByTestId('console-btn'));
    expect(consoleStore.unreadErrors()).toBe(0);
  });
});
