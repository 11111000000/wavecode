import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
  // Reset slot + editor wiring to per-test defaults.
  if (rec.pianoSlot() !== 'append-stack') rec.setPianoSlot('append-stack');
  rec.setEditorFocused(false);
  rec.setPianoEditorApi(undefined);
  // Reset transcription state (wavecode-piano-transcribe): BPM
  // back to default, preview cleared. Without this, the BPM
  // signal leaks across tests and grid-width assertions on the
  // generated mini-notation get the wrong cell boundaries.
  rec.setTranscribeBpm(120);
  rec.cancelTranscription();
  // Reset score so applyToScore tests start from empty editor.
  const { dispatch } = await import('../state/appStore');
  dispatch({ type: 'replaceScore', text: '' });
});

afterEach(() => {
  cleanup();
});

describe('PianoToolbar — instrument selector (wavecode-piano-sample-picker)', () => {
  it('renders 8 instrument buttons (4 sample + 4 oscillator)', () => {
    const { container } = render(() => <PianoToolbar />);
    const buttons = container.querySelectorAll<HTMLButtonElement>('.piano-inst-btn');
    expect(buttons).toHaveLength(8);
  });

  it('first 4 buttons are sample labels (Piano, Casio, Guitar, Synth)', () => {
    const { container } = render(() => <PianoToolbar />);
    const buttons = container.querySelectorAll<HTMLButtonElement>('.piano-inst-btn');
    expect(buttons[0]!.textContent).toBe('Piano');
    expect(buttons[1]!.textContent).toBe('Casio');
    expect(buttons[2]!.textContent).toBe('Guitar');
    expect(buttons[3]!.textContent).toBe('Synth');
  });

  it('last 4 buttons are oscillator glyphs (△ ∿ ⊿ ⊓)', () => {
    const { container } = render(() => <PianoToolbar />);
    const buttons = container.querySelectorAll<HTMLButtonElement>('.piano-inst-btn');
    expect(buttons[4]!.textContent).toBe('△');
    expect(buttons[5]!.textContent).toBe('∿');
    expect(buttons[6]!.textContent).toBe('⊿');
    expect(buttons[7]!.textContent).toBe('⊓');
  });

  it('each sample button has a data-instrument attribute matching its id', () => {
    const { container } = render(() => <PianoToolbar />);
    const buttons = container.querySelectorAll<HTMLButtonElement>('.piano-inst-btn');
    expect(buttons[0]!.getAttribute('data-instrument')).toBe('piano');
    expect(buttons[1]!.getAttribute('data-instrument')).toBe('casio');
    expect(buttons[2]!.getAttribute('data-instrument')).toBe('guitar');
    expect(buttons[3]!.getAttribute('data-instrument')).toBe('synth');
  });

  it('sample button title explains that REC writes s("<name>")', () => {
    const { container } = render(() => <PianoToolbar />);
    const buttons = container.querySelectorAll<HTMLButtonElement>('.piano-inst-btn');
    expect(buttons[0]!.getAttribute('title')).toContain('s("piano")');
    expect(buttons[1]!.getAttribute('title')).toContain('s("casio")');
    expect(buttons[2]!.getAttribute('title')).toContain('s("guitar")');
    expect(buttons[3]!.getAttribute('title')).toContain('s("synth")');
  });

  it('default instrument (triangle) is one of the last 4 buttons', () => {
    const { container } = render(() => <PianoToolbar />);
    const buttons = container.querySelectorAll<HTMLButtonElement>('.piano-inst-btn');
    // The default 'triangle' is the 5th button (index 4).
    expect(buttons[4]!.getAttribute('data-active')).toBe('true');
    for (let i = 0; i < 8; i += 1) {
      if (i !== 4) {
        expect(buttons[i]!.getAttribute('data-active')).toBe('false');
      }
    }
  });

  it('clicking a sample button sets the instrument signal + flips data-active', async () => {
    const rec = await import('../state/pianoRecStore');
    const { container, getByLabelText } = render(() => <PianoToolbar />);
    fireEvent.click(getByLabelText('Инструмент: Piano') as HTMLButtonElement);
    expect(rec.instrument()).toBe('piano');
    const buttons = container.querySelectorAll<HTMLButtonElement>('.piano-inst-btn');
    expect(buttons[0]!.getAttribute('data-active')).toBe('true');
    expect(buttons[4]!.getAttribute('data-active')).toBe('false');
  });

  it('clicking an oscillator button still works (regression)', async () => {
    const rec = await import('../state/pianoRecStore');
    const { container, getByLabelText } = render(() => <PianoToolbar />);
    // Oscillator literals keep their unicode glyph as label
    // (△ ∿ ⊿ ⊓), not a transliterated word — see INSTRUMENT_LABEL.
    fireEvent.click(getByLabelText('Инструмент: ∿') as HTMLButtonElement);
    expect(rec.instrument()).toBe('sine');
    const buttons = container.querySelectorAll<HTMLButtonElement>('.piano-inst-btn');
    expect(buttons[5]!.getAttribute('data-active')).toBe('true');
  });

  it('instrument setter preserves rec buffer (separate concerns)', async () => {
    const rec = await import('../state/pianoRecStore');
    rec.appendNote(60, 0, 100);
    const { getByLabelText } = render(() => <PianoToolbar />);
    fireEvent.click(getByLabelText('Инструмент: ⊓') as HTMLButtonElement);
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

// =========================================================================
// wavecode-piano-rec-clarity — slot selector + preview-pill
// =========================================================================

describe('PianoToolbar — slot selector (wavecode-piano-rec-clarity)', () => {
  it('renders three slot buttons with correct aria-labels', async () => {
    const { container } = render(() => <PianoToolbar />);
    const slots = container.querySelectorAll<HTMLButtonElement>('.piano-slot-btn');
    expect(slots).toHaveLength(3);
    expect(slots[0]!.getAttribute('data-slot')).toBe('append-stack');
    expect(slots[1]!.getAttribute('data-slot')).toBe('replace-score');
    expect(slots[2]!.getAttribute('data-slot')).toBe('at-cursor');
    expect(slots[0]!.getAttribute('aria-label')).toMatch(/конец стека/);
    expect(slots[1]!.getAttribute('aria-label')).toMatch(/заменить score/);
    expect(slots[2]!.getAttribute('aria-label')).toMatch(/курсор/);
  });

  it('default slot is append-stack (data-active=true)', async () => {
    const { container } = render(() => <PianoToolbar />);
    const slots = container.querySelectorAll<HTMLButtonElement>('.piano-slot-btn');
    expect(slots[0]!.getAttribute('data-active')).toBe('true');
    expect(slots[1]!.getAttribute('data-active')).toBe('false');
    expect(slots[2]!.getAttribute('data-active')).toBe('false');
  });

  it('clicking a slot flips data-active', async () => {
    const rec = await import('../state/pianoRecStore');
    const { container, getByLabelText } = render(() => <PianoToolbar />);
    fireEvent.click(getByLabelText(/заменить score/) as HTMLButtonElement);
    expect(rec.pianoSlot()).toBe('replace-score');
    const slots = container.querySelectorAll<HTMLButtonElement>('.piano-slot-btn');
    expect(slots[1]!.getAttribute('data-active')).toBe('true');
    expect(slots[0]!.getAttribute('data-active')).toBe('false');
  });

  it('at-cursor slot is disabled when editor is not focused', async () => {
    const rec = await import('../state/pianoRecStore');
    rec.setEditorFocused(false);
    const { container } = render(() => <PianoToolbar />);
    const cursorBtn = container.querySelector<HTMLButtonElement>(
      '.piano-slot-btn[data-slot="at-cursor"]',
    )!;
    expect(cursorBtn.disabled).toBe(true);
    expect(cursorBtn.getAttribute('title')).toMatch(/Тапните в редактор/);
  });

  it('at-cursor slot becomes enabled when editor is focused', async () => {
    const rec = await import('../state/pianoRecStore');
    rec.setEditorFocused(true);
    const { container } = render(() => <PianoToolbar />);
    const cursorBtn = container.querySelector<HTMLButtonElement>(
      '.piano-slot-btn[data-slot="at-cursor"]',
    )!;
    expect(cursorBtn.disabled).toBe(false);
    expect(cursorBtn.getAttribute('title')).toMatch(/Вставить в позицию курсора/);
  });

  it('clicking apply with replace-score slot overwrites the score (no wrap)', async () => {
    const rec = await import('../state/pianoRecStore');
    const { appStore, dispatch } = await import('../state/appStore');
    if (!rec.recEnabled()) rec.toggleRec();
    rec.setPianoSlot('replace-score');
    dispatch({ type: 'replaceScore', text: 's("hh*4")' });
    rec.appendNote(60, 0, 100);
    const { container } = render(() => <PianoToolbar />);
    const apply = container.querySelector<HTMLButtonElement>('.piano-apply-btn')!;
    fireEvent.click(apply);
    expect(appStore.score).toContain('note("c4")');
    expect(appStore.score).not.toContain('hh*4'); // destructive
  });

  it('clicking apply with at-cursor slot dispatches insert via editor API', async () => {
    const rec = await import('../state/pianoRecStore');
    const { appStore, dispatch } = await import('../state/appStore');
    if (!rec.recEnabled()) rec.toggleRec();
    rec.setPianoSlot('at-cursor');
    dispatch({ type: 'replaceScore', text: 'note("e4")' });
    rec.appendNote(60, 0, 100);
    // Mock view with cursor at offset 10
    const dispatches: Array<unknown> = [];
    const fakeView = {
      state: {
        selection: { main: { from: 10, to: 10 } },
        doc: {
          lineAt: (p: number): { from: number; number: number } => ({
            from: p,
            number: 1,
          }),
          length: 100,
        },
      },
      dispatch: (tr: unknown): void => {
        dispatches.push(tr);
      },
      destroyed: false,
    };
    rec.setPianoEditorApi({ getView: () => fakeView as never });
    rec.setEditorFocused(true);
    const { container } = render(() => <PianoToolbar />);
    const apply = container.querySelector<HTMLButtonElement>('.piano-apply-btn')!;
    fireEvent.click(apply);
    // Two dispatches: (1) the insert + (2) the flash-decoration effect.
    expect(dispatches.length).toBeGreaterThanOrEqual(1);
    // Editor's text was inserted in the fake view, NOT dispatched as
    // a global replaceScore — `appStore.score` is unchanged.
    expect(appStore.score).toBe('note("e4")');
  });
});

describe('PianoToolbar — preview-pill (wavecode-piano-rec-clarity)', () => {
  it('is hidden when the buffer is empty', () => {
    const { container } = render(() => <PianoToolbar />);
    expect(container.querySelector('.piano-rec-pill')).toBeNull();
  });

  it('is hidden when REC is off (even with non-empty buffer)', async () => {
    const rec = await import('../state/pianoRecStore');
    if (rec.recEnabled()) rec.toggleRec();
    rec.appendNote(60, 0, 100);
    const { container } = render(() => <PianoToolbar />);
    expect(container.querySelector('.piano-rec-pill')).toBeNull();
  });

  it('renders count + first note names + slot label when REC on + buffer non-empty', async () => {
    const rec = await import('../state/pianoRecStore');
    if (!rec.recEnabled()) rec.toggleRec();
    rec.appendNote(60, 0, 100); // C4
    rec.appendNote(64, 100, 200); // E4
    const { container } = render(() => <PianoToolbar />);
    const pill = container.querySelector<HTMLSpanElement>('.piano-rec-pill');
    expect(pill).toBeTruthy();
    expect(pill!.textContent).toContain('REC');
    expect(pill!.textContent).toContain('2');
    expect(pill!.textContent).toContain('C4');
    expect(pill!.textContent).toContain('E4');
    expect(pill!.textContent).toContain('конец стека');
    expect(pill!.getAttribute('data-slot')).toBe('append-stack');
    expect(pill!.getAttribute('data-active')).toBe('true');
  });

  it('reflects current slot label (replace-score / at-cursor)', async () => {
    const rec = await import('../state/pianoRecStore');
    if (!rec.recEnabled()) rec.toggleRec();
    rec.appendNote(60, 0, 100);
    rec.setPianoSlot('replace-score');
    const { container } = render(() => <PianoToolbar />);
    const pill = container.querySelector<HTMLSpanElement>('.piano-rec-pill');
    expect(pill!.textContent).toContain('заменить score');
    expect(pill!.getAttribute('data-slot')).toBe('replace-score');
  });

  it('shows "✓ Применено" briefly after a successful apply', async () => {
    const rec = await import('../state/pianoRecStore');
    if (!rec.recEnabled()) rec.toggleRec();
    rec.appendNote(60, 0, 100);
    const { container } = render(() => <PianoToolbar />);
    const apply = container.querySelector<HTMLButtonElement>('.piano-apply-btn')!;
    fireEvent.click(apply);
    // Solid's <Show> memoises + updates reactively; let the
    // microtask queue drain before re-querying the DOM.
    await new Promise((r) => setTimeout(r, 0));
    const applied = container.querySelector<HTMLSpanElement>('.piano-rec-pill--applied');
    expect(applied).toBeTruthy();
    expect(applied!.getAttribute('data-applied')).toBe('true');
    expect(applied!.textContent).toMatch(/✓ Применено/);
  });
});

// =========================================================================
// wavecode-piano-transcribe — REC buffer → Strudel-score auto-transcription
// =========================================================================

describe('PianoToolbar — 🎼 transcribe button (wavecode-piano-transcribe)', () => {
  it('is hidden when the rec buffer is empty', () => {
    const { container } = render(() => <PianoToolbar />);
    expect(container.querySelector('.piano-transcribe-btn')).toBeNull();
  });

  it('is visible when the buffer has at least one note (no REC required)', async () => {
    const rec = await import('../state/pianoRecStore');
    if (rec.recEnabled()) rec.toggleRec();
    rec.appendNote(60, 0, 100);
    const { container } = render(() => <PianoToolbar />);
    expect(container.querySelector('.piano-transcribe-btn')).toBeTruthy();
    expect(container.querySelector('.piano-transcribe-bpm')).toBeTruthy();
  });

  it('BPM input defaults to 120 and updates the signal on input', async () => {
    const rec = await import('../state/pianoRecStore');
    if (rec.recEnabled()) rec.toggleRec();
    rec.appendNote(60, 0, 100);
    expect(rec.transcribeBpm()).toBe(120);
    rec.setTranscribeBpm(90);
    const { container } = render(() => <PianoToolbar />);
    const input = container.querySelector<HTMLInputElement>('.piano-transcribe-bpm__input')!;
    expect(input.value).toBe('90');
  });

  it('clicking 🎼 transcribe populates the preview panel with mini-notation', async () => {
    const rec = await import('../state/pianoRecStore');
    if (!rec.recEnabled()) rec.toggleRec();
    // 4 sixteenth notes at 120bpm → 4 columns, single-cat pattern.
    rec.appendNote(60, 0, 100);
    rec.appendNote(62, 125, 225);
    rec.appendNote(64, 250, 350);
    rec.appendNote(67, 375, 475);
    const { container } = render(() => <PianoToolbar />);
    const btn = container.querySelector<HTMLButtonElement>('.piano-transcribe-btn')!;
    fireEvent.click(btn);
    await new Promise((r) => setTimeout(r, 0));
    const preview = container.querySelector<HTMLElement>('.piano-transcribe-preview');
    expect(preview).toBeTruthy();
    const score = container.querySelector<HTMLElement>('.piano-transcribe-preview__score');
    expect(score!.textContent).toContain('note("<c4 d4 e4 g4>")');
    expect(preview!.getAttribute('data-bpm')).toBe('120');
    expect(preview!.getAttribute('data-valid')).toBe('true');
  });

  it('summary text reflects the recording (notes → columns, beats)', async () => {
    const rec = await import('../state/pianoRecStore');
    if (!rec.recEnabled()) rec.toggleRec();
    rec.appendNote(60, 0, 100);
    rec.appendNote(64, 0, 100);
    rec.appendNote(67, 0, 100);
    const { container } = render(() => <PianoToolbar />);
    fireEvent.click(container.querySelector<HTMLButtonElement>('.piano-transcribe-btn')!);
    await new Promise((r) => setTimeout(r, 0));
    const summary = container.querySelector<HTMLElement>('.piano-transcribe-preview__summary');
    // 3 ноты → 1 столбец, 1 бит
    expect(summary!.textContent).toContain('3 ноты');
    expect(summary!.textContent).toContain('1 столбец');
    expect(summary!.textContent).toContain('1 бит');
  });

  it('Apply dispatches replaceScore with the previewed score + calls evalScore', async () => {
    const rec = await import('../state/pianoRecStore');
    const { appStore } = await import('../state/appStore');
    // Spy on evalScore via the audioActions module
    const audioActions = await import('../state/audioActions');
    const evalSpy = vi.spyOn(audioActions, 'evalScore').mockResolvedValue(undefined);

    if (!rec.recEnabled()) rec.toggleRec();
    rec.appendNote(60, 0, 100);
    rec.appendNote(64, 125, 225);
    rec.appendNote(67, 250, 350);
    const { container } = render(() => <PianoToolbar />);
    fireEvent.click(container.querySelector<HTMLButtonElement>('.piano-transcribe-btn')!);
    await new Promise((r) => setTimeout(r, 0));
    const apply = container.querySelector<HTMLButtonElement>('.piano-transcribe-preview__apply')!;
    fireEvent.click(apply);
    await new Promise((r) => setTimeout(r, 0));

    expect(appStore.score).toContain('note("<c4 e4 g4>")');
    expect(evalSpy).toHaveBeenCalledTimes(1);
    expect(evalSpy.mock.calls[0]![0]).toContain('note("<c4 e4 g4>")');
    expect(rec.recBuffer()).toEqual([]); // buffer cleared
    expect(rec.transcribePreview()).toBeNull(); // preview cleared
    evalSpy.mockRestore();
  });

  it('Cancel clears the preview without dispatching replaceScore', async () => {
    const rec = await import('../state/pianoRecStore');
    const { appStore } = await import('../state/appStore');
    const audioActions = await import('../state/audioActions');
    const evalSpy = vi.spyOn(audioActions, 'evalScore').mockResolvedValue(undefined);

    if (!rec.recEnabled()) rec.toggleRec();
    rec.appendNote(60, 0, 100);
    const { container } = render(() => <PianoToolbar />);
    fireEvent.click(container.querySelector<HTMLButtonElement>('.piano-transcribe-btn')!);
    await new Promise((r) => setTimeout(r, 0));
    expect(rec.transcribePreview()).not.toBeNull();
    const before = appStore.score;
    const cancel = container.querySelector<HTMLButtonElement>('.piano-transcribe-preview__cancel')!;
    fireEvent.click(cancel);
    await new Promise((r) => setTimeout(r, 0));
    expect(rec.transcribePreview()).toBeNull();
    expect(appStore.score).toBe(before); // unchanged
    expect(evalSpy).not.toHaveBeenCalled();
    expect(rec.recBuffer().length).toBeGreaterThan(0); // buffer preserved
    evalSpy.mockRestore();
  });

  it('preview panel disappears when the buffer is cleared (post-apply)', async () => {
    const rec = await import('../state/pianoRecStore');
    const audioActions = await import('../state/audioActions');
    vi.spyOn(audioActions, 'evalScore').mockResolvedValue(undefined);

    if (!rec.recEnabled()) rec.toggleRec();
    rec.appendNote(60, 0, 100);
    const { container } = render(() => <PianoToolbar />);
    fireEvent.click(container.querySelector<HTMLButtonElement>('.piano-transcribe-btn')!);
    await new Promise((r) => setTimeout(r, 0));
    expect(container.querySelector('.piano-transcribe-preview')).toBeTruthy();
    fireEvent.click(container.querySelector<HTMLButtonElement>('.piano-transcribe-preview__apply')!);
    await new Promise((r) => setTimeout(r, 0));
    // After apply: buffer cleared, preview cleared → panel gone.
    expect(container.querySelector('.piano-transcribe-preview')).toBeNull();
  });

  it('instrument name from store flows into the generated score (.s("triangle") default)', async () => {
    const rec = await import('../state/pianoRecStore');
    // Reset to triangle (the default instrument).
    rec.setInstrument('triangle');
    if (!rec.recEnabled()) rec.toggleRec();
    rec.appendNote(60, 0, 100);
    const { container } = render(() => <PianoToolbar />);
    fireEvent.click(container.querySelector<HTMLButtonElement>('.piano-transcribe-btn')!);
    await new Promise((r) => setTimeout(r, 0));
    const score = container.querySelector<HTMLElement>('.piano-transcribe-preview__score');
    expect(score!.textContent).toContain('.s("triangle")');
  });
});