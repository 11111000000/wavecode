import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@solidjs/testing-library';

const captureKeydownHandler = (): ((e: KeyboardEvent) => void) => {
  const origAdd = window.addEventListener.bind(window);
  let captured: ((e: KeyboardEvent) => void) | null = null;
  window.addEventListener = ((event: string, handler: EventListenerOrEventListenerObject) => {
    if (event === 'keydown' && typeof handler === 'function') {
      captured = handler as (e: KeyboardEvent) => void;
    }
    return origAdd(event, handler);
  }) as typeof window.addEventListener;
  return (e: KeyboardEvent) => {
    if (captured) captured(e);
  };
};

const fire = (
  captured: (e: KeyboardEvent) => void,
  init: KeyboardEventInit,
  target?: EventTarget | null,
): void => {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  if (target) Object.defineProperty(event, 'target', { value: target, configurable: true });
  captured(event);
};

describe('useKeyboardShortcuts — wiring + invocation', () => {
  let originalAdd: typeof window.addEventListener;
  let originalRemove: typeof window.removeEventListener;
  let fireKeydown: (e: KeyboardEvent) => void;

  beforeEach(() => {
    vi.resetModules();
    originalAdd = window.addEventListener;
    originalRemove = window.removeEventListener;
    fireKeydown = captureKeydownHandler();
  });

  afterEach(() => {
    window.addEventListener = originalAdd;
    window.removeEventListener = originalRemove;
  });

  it('installs a keydown handler on mount', async () => {
    const { useKeyboardShortcuts } = await import('./useKeyboardShortcuts');
    const handlers = {
      focusAI: vi.fn(),
      focusScore: vi.fn(),
      undoScore: vi.fn(),
      redoScore: vi.fn(),
    };
    renderHook(() => useKeyboardShortcuts(handlers));
    fire(fireKeydown, { key: 'z', ctrlKey: true }, document.createElement('div'));
    expect(handlers.undoScore).toHaveBeenCalledTimes(1);
    expect(handlers.redoScore).not.toHaveBeenCalled();
  });

  it('routes Ctrl+. to focusAI', async () => {
    const { useKeyboardShortcuts } = await import('./useKeyboardShortcuts');
    const handlers = {
      focusAI: vi.fn(),
      focusScore: vi.fn(),
      undoScore: vi.fn(),
      redoScore: vi.fn(),
    };
    renderHook(() => useKeyboardShortcuts(handlers));
    fire(fireKeydown, { key: '.', ctrlKey: true }, document.createElement('div'));
    expect(handlers.focusAI).toHaveBeenCalledTimes(1);
  });

  it('routes Ctrl+, to focusScore', async () => {
    const { useKeyboardShortcuts } = await import('./useKeyboardShortcuts');
    const handlers = {
      focusAI: vi.fn(),
      focusScore: vi.fn(),
      undoScore: vi.fn(),
      redoScore: vi.fn(),
    };
    renderHook(() => useKeyboardShortcuts(handlers));
    fire(fireKeydown, { key: ',', ctrlKey: true }, document.createElement('div'));
    expect(handlers.focusScore).toHaveBeenCalledTimes(1);
  });

  it('routes Ctrl+Y to redoScore', async () => {
    const { useKeyboardShortcuts } = await import('./useKeyboardShortcuts');
    const handlers = {
      focusAI: vi.fn(),
      focusScore: vi.fn(),
      undoScore: vi.fn(),
      redoScore: vi.fn(),
    };
    renderHook(() => useKeyboardShortcuts(handlers));
    fire(fireKeydown, { key: 'y', ctrlKey: true }, document.createElement('div'));
    expect(handlers.redoScore).toHaveBeenCalledTimes(1);
  });

  it('routes Ctrl+Shift+A to openAdmin when provided', async () => {
    const { useKeyboardShortcuts } = await import('./useKeyboardShortcuts');
    const handlers = {
      focusAI: vi.fn(),
      focusScore: vi.fn(),
      undoScore: vi.fn(),
      redoScore: vi.fn(),
      openAdmin: vi.fn(),
    };
    renderHook(() => useKeyboardShortcuts(handlers));
    fire(fireKeydown, { key: 'a', ctrlKey: true, shiftKey: true }, document.createElement('div'));
    expect(handlers.openAdmin).toHaveBeenCalledTimes(1);
  });

  it('does not throw when openAdmin is omitted', async () => {
    const { useKeyboardShortcuts } = await import('./useKeyboardShortcuts');
    const handlers = {
      focusAI: vi.fn(),
      focusScore: vi.fn(),
      undoScore: vi.fn(),
      redoScore: vi.fn(),
    };
    renderHook(() => useKeyboardShortcuts(handlers));
    expect(() =>
      fire(fireKeydown, { key: 'a', ctrlKey: true, shiftKey: true }, document.createElement('div')),
    ).not.toThrow();
  });
});
