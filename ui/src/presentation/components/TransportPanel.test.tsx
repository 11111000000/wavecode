import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@solidjs/testing-library';
import { TransportPanel } from './TransportPanel';

const noop = (): void => undefined;

const renderPanel = (
  audioRunning: () => boolean = () => false,
  audioStarting: () => boolean = () => false,
  onPlay: () => void = noop,
  onStop: () => void = noop,
): ReturnType<typeof render> => render(() => (
  <TransportPanel
    audioRunning={audioRunning}
    audioStarting={audioStarting}
    onPlay={onPlay}
    onStop={onStop}
  />
));

describe('TransportPanel — Play/Stop button (math/wavecode-play-in-control)', () => {
  afterEach(() => cleanup());

  it('audioRunning=false → amber Play button with PlayIcon, aria-label="Запуск"', () => {
    const { container } = renderPanel(() => false);
    const btn = container.querySelector(
      '[data-testid="transport-play-btn"]',
    ) as HTMLButtonElement | null;
    expect(btn).toBeTruthy();
    expect(btn!.getAttribute('aria-label')).toBe('Запуск');
    expect(btn!.getAttribute('data-tone')).toBe('primary');
    expect(btn!.getAttribute('data-state')).toBe('play');
    // The PlayIcon path is the triangle `M3 2 L13 8 L3 14 Z`.
    const svg = btn!.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg!.querySelector('path[d^="M3 2"]')).toBeTruthy();
    expect(svg!.querySelector('rect')).toBeNull();
  });

  it('audioRunning=true → cyan Stop button with StopIcon, aria-label="Стоп"', () => {
    const { container } = renderPanel(() => true);
    const btn = container.querySelector(
      '[data-testid="transport-play-btn"]',
    ) as HTMLButtonElement | null;
    expect(btn).toBeTruthy();
    expect(btn!.getAttribute('aria-label')).toBe('Стоп');
    expect(btn!.getAttribute('data-tone')).toBe('cyan');
    expect(btn!.getAttribute('data-state')).toBe('stop');
    // The StopIcon is a filled rect.
    const svg = btn!.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg!.querySelector('rect')).toBeTruthy();
    expect(svg!.querySelector('path[d^="M3 2"]')).toBeNull();
  });

  it('click in stopped state → onPlay called 1×, onStop NOT called', () => {
    const onPlay = vi.fn();
    const onStop = vi.fn();
    const { container } = renderPanel(() => false, () => false, onPlay, onStop);
    const btn = container.querySelector(
      '[data-testid="transport-play-btn"]',
    ) as HTMLButtonElement;
    fireEvent.click(btn);
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onStop).not.toHaveBeenCalled();
  });

  it('click in running state → onStop called 1×, onPlay NOT called', () => {
    const onPlay = vi.fn();
    const onStop = vi.fn();
    const { container } = renderPanel(() => true, () => false, onPlay, onStop);
    const btn = container.querySelector(
      '[data-testid="transport-play-btn"]',
    ) as HTMLButtonElement;
    fireEvent.click(btn);
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onPlay).not.toHaveBeenCalled();
  });

  it('audioStarting=true + running=false → aria-busy="true" and button is disabled', () => {
    const { container } = renderPanel(() => false, () => true);
    const btn = container.querySelector(
      '[data-testid="transport-play-btn"]',
    ) as HTMLButtonElement;
    expect(btn.getAttribute('aria-busy')).toBe('true');
    expect(btn.disabled).toBe(true);
  });

  it('aria-pressed mirrors audioRunning (true when running, false otherwise)', () => {
    const { container: c1 } = renderPanel(() => false);
    const btn1 = c1.querySelector(
      '[data-testid="transport-play-btn"]',
    ) as HTMLButtonElement;
    expect(btn1.getAttribute('aria-pressed')).toBe('false');

    cleanup();

    const { container: c2 } = renderPanel(() => true);
    const btn2 = c2.querySelector(
      '[data-testid="transport-play-btn"]',
    ) as HTMLButtonElement;
    expect(btn2.getAttribute('aria-pressed')).toBe('true');
  });

  it('renders without onPlay/onStop props (default = noop) and does not throw', () => {
    expect(() => render(() => <TransportPanel />)).not.toThrow();
    // Click should also not throw and the button must still render.
    const { container } = render(() => <TransportPanel />);
    const btn = container.querySelector(
      '[data-testid="transport-play-btn"]',
    ) as HTMLButtonElement;
    expect(btn).toBeTruthy();
    expect(() => fireEvent.click(btn)).not.toThrow();
  });
});
