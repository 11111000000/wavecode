import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@solidjs/testing-library';
import { RhythmMiniFAB } from './RhythmMiniFAB';
import {
  __resetRhythmForTests,
  rhythmPhase,
  rhythmPanelArmed,
} from '../state/rhythmStore';
import { resetMicMutexForTests } from '../state/micMutexStore';

/**
 * RhythmMiniFAB render tests.
 *
 * The button is a TOGGLE, exactly like the whistle and the voice
 * buttons — one rule for the whole cluster:
 *
 *   press → the take starts, the button becomes a REC button;
 *   press → the take pauses, the hits stay in the buffer and the
 *           panel stays open so «Применить» remains reachable.
 */

beforeEach(() => {
  __resetRhythmForTests();
  resetMicMutexForTests();
});

afterEach(() => {
  cleanup();
  __resetRhythmForTests();
  resetMicMutexForTests();
});

/** Let the fire-and-forget Effect settle. */
const settle = (): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, 30));

describe('RhythmMiniFAB — render', () => {
  it('renders with class voice-mini-fab--rhythm', () => {
    const { container } = render(() => <RhythmMiniFAB />);
    const btn = container.querySelector('.voice-mini-fab.voice-mini-fab--rhythm');
    expect(btn).toBeTruthy();
  });

  it('renders an SVG drum icon', () => {
    const { container } = render(() => <RhythmMiniFAB />);
    const btn = container.querySelector('.voice-mini-fab')!;
    expect(btn.querySelector('svg.wc-icon')).toBeTruthy();
  });

  it('is labelled "Ритм" and names the action for assistive tech', () => {
    const { container } = render(() => <RhythmMiniFAB />);
    const btn = container.querySelector('.voice-mini-fab--rhythm')!;
    expect(btn.querySelector('.voice-mini-fab__label')?.textContent).toBe('Ритм');
    expect(btn.getAttribute('aria-label')).toContain('ритм');
  });
});

describe('RhythmMiniFAB — the press toggles the take', () => {
  it('a press starts a take', async () => {
    const { container } = render(() => <RhythmMiniFAB />);
    const btn = container.querySelector<HTMLButtonElement>(
      '.voice-mini-fab--rhythm',
    )!;
    fireEvent.click(btn);
    await settle();
    expect(rhythmPhase()).toBe('recording');
  });

  it('the next press pauses the take', async () => {
    const { container } = render(() => <RhythmMiniFAB />);
    const btn = container.querySelector<HTMLButtonElement>(
      '.voice-mini-fab--rhythm',
    )!;
    fireEvent.click(btn);
    await settle();
    fireEvent.click(btn);
    await settle();
    expect(rhythmPhase()).toBe('idle');
  });

  it('REGRESSION: the paused take keeps the panel armed so «Применить» stays reachable', async () => {
    // Without arming on the pause path the paused take takes the
    // panel off screen together with the hits, and those hits can
    // never be committed.
    const { container } = render(() => <RhythmMiniFAB />);
    const btn = container.querySelector<HTMLButtonElement>(
      '.voice-mini-fab--rhythm',
    )!;
    fireEvent.click(btn);
    await settle();
    fireEvent.click(btn);
    await settle();

    expect(rhythmPhase()).toBe('idle');
    expect(rhythmPanelArmed()).toBe(true);
  });
});

describe('RhythmMiniFAB — the REC state', () => {
  it('turns into a REC button while the take is running', async () => {
    const { container } = render(() => <RhythmMiniFAB />);
    const btn = container.querySelector<HTMLButtonElement>(
      '.voice-mini-fab--rhythm',
    )!;
    expect(btn.getAttribute('data-rec-state')).toBe('off');
    expect(container.querySelector('.voice-mini-fab__rec-dot')).toBeNull();
    expect(btn.querySelector('.voice-mini-fab__label')?.textContent).toBe('Ритм');

    fireEvent.click(btn);
    await settle();

    expect(btn.getAttribute('data-rec-state')).toBe('on');
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    // The drum glyph is replaced by the blinking dot.
    expect(container.querySelector('.voice-mini-fab__rec-dot')).toBeTruthy();
    expect(btn.querySelector('svg.wc-icon')).toBeNull();
    expect(btn.querySelector('.voice-mini-fab__label')?.textContent).toBe('REC');
  });
});
