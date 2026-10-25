import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@solidjs/testing-library';
import { WhistleMiniFAB } from './WhistleMiniFAB';
import {
  __resetWhistleForTests,
  whistleState,
  setWhistleState,
  whistleInstrumentLabel,
  whistlePanelArmed,
} from '../state/whistleStore';
import { __resetVoiceAIForTests } from '../state/voiceAIStore';
import { resetMicMutexForTests } from '../state/micMutexStore';

/**
 * WhistleMiniFAB render tests.
 *
 * The button is a TOGGLE (`decisions/wavecode-voice-fab-toggle-rec`):
 *
 *   press → the take starts, the button becomes a REC button;
 *   press → the take pauses, the notes stay in the buffer and the
 *           panel stays open so «Применить» remains reachable.
 *
 * The old contract was press-and-hold: the take ended with the
 * finger, and every note had to fit inside one grip.
 */

beforeEach(() => {
  __resetVoiceAIForTests();
  __resetWhistleForTests();
  resetMicMutexForTests();
});

afterEach(() => {
  cleanup();
  __resetVoiceAIForTests();
  __resetWhistleForTests();
  resetMicMutexForTests();
});

/** Let the fire-and-forget Effect settle. */
const settle = (): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, 30));

describe('WhistleMiniFAB — render', () => {
  it('renders with class voice-mini-fab--whistle', () => {
    const { container } = render(() => <WhistleMiniFAB />);
    const btn = container.querySelector('.voice-mini-fab.voice-mini-fab--whistle');
    expect(btn).toBeTruthy();
  });

  it('renders an SVG whistle icon', () => {
    const { container } = render(() => <WhistleMiniFAB />);
    const btn = container.querySelector('.voice-mini-fab')!;
    const svg = btn.querySelector('svg.wc-icon');
    expect(svg).toBeTruthy();
  });
});

describe('WhistleMiniFAB — hint chip names the instrument', () => {
  it('shows "слушаю… · пианино" while recording', async () => {
    // Whistle dropped its instrument selector, so before this the chip
    // said only "слушаю…" and the user had no way to know what would
    // come out of the speakers. The chip now names the instrument.
    setWhistleState({
      tag: 'recording',
      micState: { openNote: null, notes: [], lastClosedMs: null, notesPrunedCount: 0 },
      startedAtMs: 0,
      lastFrameMs: 0,
    });
    const { container } = render(() => <WhistleMiniFAB />);
    const hint = container.querySelector('.voice-mini-fab__hint');
    expect(hint?.textContent).toContain('слушаю…');
    expect(hint?.textContent).toContain(whistleInstrumentLabel());
    expect(hint?.textContent).toContain('пианино');
  });
});

describe('WhistleMiniFAB — the press toggles the take', () => {
  it('a press starts a session (FSM lands in non-idle under fallback)', async () => {
    const { container } = render(() => <WhistleMiniFAB />);
    const btn = container.querySelector<HTMLButtonElement>(
      '.voice-mini-fab--whistle',
    )!;
    fireEvent.click(btn);
    await settle();
    expect(whistleState().tag).not.toBe('idle');
  });

  it('the next press pauses the session (FSM returns to idle)', async () => {
    const { container } = render(() => <WhistleMiniFAB />);
    const btn = container.querySelector<HTMLButtonElement>(
      '.voice-mini-fab--whistle',
    )!;
    fireEvent.click(btn);
    await settle();
    fireEvent.click(btn);
    await settle();
    expect(whistleState().tag).toBe('idle');
  });

  it('REGRESSION: the paused take keeps the panel armed so «Применить» stays reachable', async () => {
    // `stopWhistle()` drops the whistle FSM back to `idle`, and
    // `RecordingPanel.mode` only stays visible while the FSM is
    // arming/recording/segmenting OR while `whistlePanelArmed`
    // holds. Without arming on the pause path the paused take takes
    // the panel off screen together with the notes the user just
    // whistled, and those notes can never be spliced.
    const { container } = render(() => <WhistleMiniFAB />);
    const btn = container.querySelector<HTMLButtonElement>(
      '.voice-mini-fab--whistle',
    )!;
    fireEvent.click(btn);
    await settle();
    fireEvent.click(btn);
    await settle();

    expect(whistleState().tag).toBe('idle');
    expect(whistlePanelArmed()).toBe(true);
  });

  it('REGRESSION: the take survives the finger leaving the button', async () => {
    // The toggle contract: releasing the pointer must NOT end the
    // recording. A browser turns pointerdown+pointerup into a
    // `click` — and it is that click that starts the take. The
    // pointerup itself must not stop it.
    const { container } = render(() => <WhistleMiniFAB />);
    const btn = container.querySelector<HTMLButtonElement>(
      '.voice-mini-fab--whistle',
    )!;
    fireEvent.pointerDown(btn);
    fireEvent.pointerUp(btn);
    fireEvent.click(btn);
    await settle();
    expect(whistleState().tag).not.toBe('idle');
  });
});

describe('WhistleMiniFAB — the REC state', () => {
  it('turns into a REC button while the take is running', async () => {
    const { container } = render(() => <WhistleMiniFAB />);
    const btn = container.querySelector<HTMLButtonElement>(
      '.voice-mini-fab--whistle',
    )!;
    expect(btn.getAttribute('data-rec-state')).toBe('off');
    expect(container.querySelector('.voice-mini-fab__rec-dot')).toBeNull();
    expect(btn.querySelector('.voice-mini-fab__label')?.textContent).toBe('Свист');

    fireEvent.click(btn);
    await settle();

    expect(btn.getAttribute('data-rec-state')).toBe('on');
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    // The whistle glyph is replaced by the blinking dot.
    expect(container.querySelector('.voice-mini-fab__rec-dot')).toBeTruthy();
    expect(btn.querySelector('svg.wc-icon')).toBeNull();
    expect(btn.querySelector('.voice-mini-fab__label')?.textContent).toBe('REC');
  });
});
