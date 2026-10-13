import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@solidjs/testing-library';
import { SampleProgressBadge } from './SampleProgressBadge';

const EVENT = 'wavecode:sample-progress';

describe('SampleProgressBadge', () => {
  beforeEach(() => {
    // Each test starts with no listeners attached.
    window.removeEventListener(EVENT, () => undefined);
  });
  afterEach(() => cleanup());

  it('renders nothing when status is idle', () => {
    const { container } = render(() => <SampleProgressBadge />);
    expect(container.querySelector('.sample-progress')).toBeNull();
    expect(container.querySelector('[data-testid="sample-progress-badge"]')).toBeNull();
  });

  it('renders the badge with the label and progress bar when status is loading', () => {
    const { container, getByTestId } = render(() => <SampleProgressBadge />);
    window.dispatchEvent(new CustomEvent(EVENT, {
      detail: { loaded: 5, total: 24, status: 'loading' },
    }));
    const badge = container.querySelector('[data-testid="sample-progress-badge"]');
    expect(badge).toBeTruthy();
    const label = getByTestId('sample-progress-label');
    expect(label.textContent).toBe('5/24 семплов');
    const bar = getByTestId('sample-progress-bar') as HTMLProgressElement;
    expect(bar.value).toBe(5);
    expect(bar.max).toBe(24);
  });

  it('updates the label and progress bar when a new event fires', () => {
    const { getByTestId } = render(() => <SampleProgressBadge />);
    window.dispatchEvent(new CustomEvent(EVENT, {
      detail: { loaded: 3, total: 24, status: 'loading' },
    }));
    expect(getByTestId('sample-progress-label').textContent).toBe('3/24 семплов');
    window.dispatchEvent(new CustomEvent(EVENT, {
      detail: { loaded: 12, total: 24, status: 'loading' },
    }));
    expect(getByTestId('sample-progress-label').textContent).toBe('12/24 семплов');
    const bar = getByTestId('sample-progress-bar') as HTMLProgressElement;
    expect(bar.value).toBe(12);
    expect(bar.max).toBe(24);
  });

  it('hides the badge when status transitions to loaded', () => {
    const { container } = render(() => <SampleProgressBadge />);
    window.dispatchEvent(new CustomEvent(EVENT, {
      detail: { loaded: 5, total: 24, status: 'loading' },
    }));
    expect(container.querySelector('.sample-progress')).toBeTruthy();
    window.dispatchEvent(new CustomEvent(EVENT, {
      detail: { loaded: 24, total: 24, status: 'loaded' },
    }));
    expect(container.querySelector('.sample-progress')).toBeNull();
  });

  it('uses the prop-provided eventName when supplied', () => {
    const customEvent = 'wavecode:sample-progress:test';
    const { container, getByTestId } = render(() => <SampleProgressBadge eventName={customEvent} />);
    // Default event should NOT trigger (no badge).
    window.dispatchEvent(new CustomEvent(EVENT, {
      detail: { loaded: 5, total: 24, status: 'loading' },
    }));
    expect(container.querySelector('.sample-progress')).toBeNull();
    // Custom event SHOULD trigger.
    window.dispatchEvent(new CustomEvent(customEvent, {
      detail: { loaded: 7, total: 36, status: 'loading' },
    }));
    expect(getByTestId('sample-progress-label').textContent).toBe('7/36 семплов');
  });

  it('guards progress bar when total is 0 (avoids division-by-zero in the native max)', () => {
    const { getByTestId } = render(() => <SampleProgressBadge />);
    window.dispatchEvent(new CustomEvent(EVENT, {
      detail: { loaded: 0, total: 0, status: 'loading' },
    }));
    const bar = getByTestId('sample-progress-bar') as HTMLProgressElement;
    expect(bar.max).toBe(1);
    expect(bar.value).toBe(0);
  });
});