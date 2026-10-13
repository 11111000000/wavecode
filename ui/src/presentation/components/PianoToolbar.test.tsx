import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@solidjs/testing-library';
import { PianoToolbar } from './PianoToolbar';

/**
 * PianoToolbar is a presentational component that reads from
 * `pianoRecStore`. Each test must reset the store (rec/buffer/instrument)
 * BEFORE the render, otherwise signal state leaks between tests.
 *
 * The MIDI status pill is opt-in via `midiStatus` prop. We don't
 * assert on it heavily here — PianoKeyboard.test.ts covers the full
 * pill integration (text format + data-active-count).
 */

beforeEach(async () => {
  const rec = await import('../state/pianoRecStore');
  rec.setInstrument('triangle');
  rec.clearRec();
  if (rec.recEnabled()) rec.toggleRec();
  if (rec.followEnabled()) rec.toggleFollow();
  // Reset score so applyToScore tests start from empty editor.
  const { dispatch } = await import('../state/appStore');
  dispatch({ type: 'replaceScore', text: '' });
});

afterEach(() => {
  cleanup();
});

describe('PianoToolbar — instrument selector', () => {
  it('renders 4 instrument buttons with the correct glyphs and titles', () => {
    const { container } = render(() => <PianoToolbar />);
    const buttons = container.querySelectorAll<HTMLButtonElement>('.piano-inst-btn');
    expect(buttons).toHaveLength(4);
    expect(buttons[0]!.textContent).toBe('△');
    expect(buttons[0]!.getAttribute('title')).toBe('triangle');
    expect(buttons[1]!.textContent).toBe('∿');
    expect(buttons[1]!.getAttribute('title')).toBe('sine');
    expect(buttons[2]!.textContent).toBe('⊿');
    expect(buttons[2]!.getAttribute('title')).toBe('sawtooth');
    expect(buttons[3]!.textContent).toBe('⊓');
    expect(buttons[3]!.getAttribute('title')).toBe('square');
  });

  it('default instrument (triangle) has data-active=true; others have false', () => {
    const { container } = render(() => <PianoToolbar />);
    const buttons = container.querySelectorAll<HTMLButtonElement>('.piano-inst-btn');
    expect(buttons[0]!.getAttribute('data-active')).toBe('true');
    expect(buttons[1]!.getAttribute('data-active')).toBe('false');
    expect(buttons[2]!.getAttribute('data-active')).toBe('false');
    expect(buttons[3]!.getAttribute('data-active')).toBe('false');
  });

  it('clicking an instrument button sets the instrument signal + flips data-active', async () => {
    const rec = await import('../state/pianoRecStore');
    const { container, getByLabelText } = render(() => <PianoToolbar />);
    fireEvent.click(getByLabelText('Инструмент: sine') as HTMLButtonElement);
    expect(rec.instrument()).toBe('sine');
    // Re-query DOM after the signal change (Solid re-renders).
    const buttons = container.querySelectorAll<HTMLButtonElement>('.piano-inst-btn');
    expect(buttons[1]!.getAttribute('data-active')).toBe('true');
    expect(buttons[0]!.getAttribute('data-active')).toBe('false');

    fireEvent.click(getByLabelText('Инструмент: sawtooth') as HTMLButtonElement);
    expect(rec.instrument()).toBe('sawtooth');
    const after = container.querySelectorAll<HTMLButtonElement>('.piano-inst-btn');
    expect(after[2]!.getAttribute('data-active')).toBe('true');
  });

  it('instrument setter preserves rec buffer (separate concerns)', async () => {
    const rec = await import('../state/pianoRecStore');
    rec.appendNote(60, 0, 100);
    const { getByLabelText } = render(() => <PianoToolbar />);
    fireEvent.click(getByLabelText('Инструмент: square') as HTMLButtonElement);
    expect(rec.recBuffer()).toEqual([{ midi: 60, startMs: 0, endMs: 100 }]);
  });
});

describe('PianoToolbar — REC button', () => {
  it('renders with title for rec-off initially', async () => {
    const rec = await import('../state/pianoRecStore');
    if (rec.recEnabled()) rec.toggleRec();
    const { container } = render(() => <PianoToolbar />);
    const btn = container.querySelector<HTMLButtonElement>('.piano-rec-btn')!;
    expect(btn.getAttribute('title')).toBe('Rec OFF — играю параллельно');
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(btn.getAttribute('aria-label')).toBe('Запись');
    expect(btn.getAttribute('data-active')).toBe('false');
  });

  it('clicking the rec button toggles recEnabled + flips aria-pressed + title', async () => {
    const rec = await import('../state/pianoRecStore');
    if (rec.recEnabled()) rec.toggleRec();
    const { container } = render(() => <PianoToolbar />);
    const btn = container.querySelector<HTMLButtonElement>('.piano-rec-btn')!;
    fireEvent.click(btn);
    expect(rec.recEnabled()).toBe(true);
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(btn.getAttribute('data-active')).toBe('true');
    expect(btn.getAttribute('title')).toBe('Rec ON — нажатия пишутся в score');
  });

  it('clicking again toggles back to off', async () => {
    const rec = await import('../state/pianoRecStore');
    if (!rec.recEnabled()) rec.toggleRec();
    const { container } = render(() => <PianoToolbar />);
    const btn = container.querySelector<HTMLButtonElement>('.piano-rec-btn')!;
    fireEvent.click(btn);
    expect(rec.recEnabled()).toBe(false);
    expect(btn.getAttribute('aria-pressed')).toBe('false');
  });
});

describe('PianoToolbar — MIDI status pill (optional)', () => {
  it('does NOT render the pill if midiStatus is omitted', () => {
    const { container } = render(() => <PianoToolbar />);
    expect(container.querySelector('.piano-midi-status')).toBeNull();
  });

  it('renders the pill when midiStatus is provided, with tone=ok for "MIDI: N device"', () => {
    const { container } = render(() => (
      <PianoToolbar midiStatus="MIDI: 1 device" midiActive={false} midiActiveCount={0} />
    ));
    const pill = container.querySelector<HTMLSpanElement>('.piano-midi-status');
    expect(pill).toBeTruthy();
    expect(pill!.textContent).toBe('MIDI: 1 device');
    expect(pill!.classList.contains('piano-midi-ok')).toBe(true);
    expect(pill!.classList.contains('has-active')).toBe(false);
    expect(pill!.getAttribute('data-active-count')).toBe('0');
  });

  it('renders tone=pending for "MIDI: no device"', () => {
    const { container } = render(() => (
      <PianoToolbar midiStatus="MIDI: no device" midiActive={false} midiActiveCount={0} />
    ));
    const pill = container.querySelector<HTMLSpanElement>('.piano-midi-status');
    expect(pill).toBeTruthy();
    expect(pill!.classList.contains('piano-midi-pending')).toBe(true);
  });

  it('adds has-active class when midiActive is true (any active note)', () => {
    const { container } = render(() => (
      <PianoToolbar midiStatus="MIDI: 1 device · 1 нота" midiActive={true} midiActiveCount={1} />
    ));
    const pill = container.querySelector<HTMLSpanElement>('.piano-midi-status');
    expect(pill!.classList.contains('has-active')).toBe(true);
    expect(pill!.getAttribute('data-active-count')).toBe('1');
  });
});

describe('PianoToolbar — FOLLOW toggle (wavecode-piano-modes-and-gain)', () => {
  it('renders a FOLLOW toggle button next to REC', () => {
    const { container } = render(() => <PianoToolbar />);
    const follow = container.querySelector<HTMLButtonElement>('.piano-follow-btn');
    expect(follow).toBeTruthy();
    expect(follow!.getAttribute('aria-label')).toBe('Подсветка от scheduler');
    expect(follow!.getAttribute('aria-pressed')).toBe('false');
    expect(follow!.getAttribute('data-active')).toBe('false');
  });

  it('clicking FOLLOW flips data-active + aria-pressed (independent of REC)', async () => {
    const rec = await import('../state/pianoRecStore');
    if (rec.recEnabled()) rec.toggleRec();
    const { container } = render(() => <PianoToolbar />);
    const follow = container.querySelector<HTMLButtonElement>('.piano-follow-btn')!;
    fireEvent.click(follow);
    expect(rec.followEnabled()).toBe(true);
    // Re-query (Solid re-renders)
    const after = container.querySelector<HTMLButtonElement>('.piano-follow-btn')!;
    expect(after.getAttribute('aria-pressed')).toBe('true');
    expect(after.getAttribute('data-active')).toBe('true');
  });

  it('FOLLOW and REC can be on simultaneously (orthogonal toggles)', async () => {
    const rec = await import('../state/pianoRecStore');
    if (rec.recEnabled()) rec.toggleRec();
    const { container } = render(() => <PianoToolbar />);
    const recBtn = container.querySelector<HTMLButtonElement>('.piano-rec-btn')!;
    const followBtn = container.querySelector<HTMLButtonElement>('.piano-follow-btn')!;
    fireEvent.click(recBtn);
    fireEvent.click(followBtn);
    expect(rec.recEnabled()).toBe(true);
    expect(rec.followEnabled()).toBe(true);
    // Both attributes flip independently.
    const recAfter = container.querySelector<HTMLButtonElement>('.piano-rec-btn')!;
    const followAfter = container.querySelector<HTMLButtonElement>('.piano-follow-btn')!;
    expect(recAfter.getAttribute('data-active')).toBe('true');
    expect(followAfter.getAttribute('data-active')).toBe('true');
  });
});

describe('PianoToolbar — ↑ apply button (wavecode-piano-modes-and-gain)', () => {
  it('is hidden when REC is off (regardless of buffer length)', async () => {
    const rec = await import('../state/pianoRecStore');
    if (rec.recEnabled()) rec.toggleRec();
    rec.appendNote(60, 0, 100); // non-empty buffer but REC is OFF
    const { container } = render(() => <PianoToolbar />);
    expect(container.querySelector('.piano-apply-btn')).toBeNull();
  });

  it('is hidden when REC is on but buffer is empty', async () => {
    const rec = await import('../state/pianoRecStore');
    if (!rec.recEnabled()) rec.toggleRec();
    expect(rec.recBuffer()).toHaveLength(0);
    const { container } = render(() => <PianoToolbar />);
    expect(container.querySelector('.piano-apply-btn')).toBeNull();
  });

  it('is visible with correct aria-label when REC on + buffer non-empty', async () => {
    const rec = await import('../state/pianoRecStore');
    if (!rec.recEnabled()) rec.toggleRec();
    rec.appendNote(60, 0, 100);
    const { container } = render(() => <PianoToolbar />);
    const apply = container.querySelector<HTMLButtonElement>('.piano-apply-btn');
    expect(apply).toBeTruthy();
    expect(apply!.getAttribute('aria-label')).toBe('Применить записанные ноты к score');
    expect(apply!.textContent).toContain('apply');
  });

  it('clicking apply dispatches replaceScore via applyToScore (orchestrator)', async () => {
    const rec = await import('../state/pianoRecStore');
    const { appStore } = await import('../state/appStore');
    if (!rec.recEnabled()) rec.toggleRec();
    rec.appendNote(60, 0, 100); // C4
    const { container } = render(() => <PianoToolbar />);
    const apply = container.querySelector<HTMLButtonElement>('.piano-apply-btn')!;
    fireEvent.click(apply);
    expect(appStore.score).toContain('note("c4")');
    expect(rec.recBuffer()).toEqual([]); // buffer cleared after apply
  });
});