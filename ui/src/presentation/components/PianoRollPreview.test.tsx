import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@solidjs/testing-library';
import { PianoRollPreview } from './PianoRollPreview';
import type { AudioNote } from '~/domain/audio/micCapture';
import type { Transient } from '~/domain/audio/transient';

/**
 * PianoRollPreview tests.
 *
 * Strategy:
 *   - Render via @solidjs/testing-library and assert DOM structure.
 *   - The component uses `performance.now()` to anchor the time window;
 *     since we feed notes with explicit `startMs` values, the window
 *     anchor becomes max(startMs)+~now. Within 3s, all our test
 *     fixtures should sit inside the visible window.
 *   - Note ids are synthesized as `n-<startMs>-<midi>-<idx>` and drum
 *     ids as `d-<startMs>-<type>-<idx>` — the test asserts on data-*
 *     attributes rather than the internal helper.
 */

const makeNote = (overrides: Partial<AudioNote> = {}): AudioNote => ({
  midi: 60,
  cents: 0,
  startMs: 1000,
  durationMs: 500,
  vibratoCents: 0,
  ...overrides,
});

const makeTransient = (overrides: Partial<Transient> = {}): Transient => ({
  type: 'kick',
  startMs: 1000,
  amplitude: 0.8,
  spectralCentroidHz: 100,
  envelopeMs: 80,
  ...overrides,
});

beforeEach(() => {
  // No-op — vi.resetModules not needed since PianoRollPreview is pure.
});

afterEach(() => {
  cleanup();
});

describe('PianoRollPreview — empty state', () => {
  it('renders empty state when both arrays are empty', () => {
    const { container } = render(() => <PianoRollPreview notes={[]} transients={[]} />);
    const root = container.querySelector('.mic-ux-piano-roll');
    expect(root).not.toBeNull();
    expect(root?.getAttribute('data-empty')).toBe('true');
    expect(container.querySelector('.mic-ux-piano-roll-empty')?.textContent).toBe('no notes yet');
  });

  it('hides empty state once a note is rendered', () => {
    const { container } = render(() => (
      <PianoRollPreview
        notes={[makeNote({ startMs: 1000, midi: 60, durationMs: 200 })]}
        transients={[]}
      />
    ));
    expect(container.querySelector('.mic-ux-piano-roll-empty')).toBeNull();
    expect(container.querySelector('.mic-ux-piano-roll')?.getAttribute('data-empty')).toBe('false');
  });

  it('hides empty state when only transients are present', () => {
    const { container } = render(() => (
      <PianoRollPreview
        notes={[]}
        transients={[makeTransient({ startMs: 1000, type: 'kick' })]}
      />
    ));
    expect(container.querySelector('.mic-ux-piano-roll-empty')).toBeNull();
  });
});

describe('PianoRollPreview — note rendering', () => {
  it('renders one rect per note', () => {
    const { container } = render(() => (
      <PianoRollPreview
        notes={[
          makeNote({ startMs: 500, midi: 60, durationMs: 300 }),
          makeNote({ startMs: 1000, midi: 64, durationMs: 300 }),
          makeNote({ startMs: 1500, midi: 67, durationMs: 300 }),
        ]}
        transients={[]}
      />
    ));
    expect(container.querySelectorAll('.mic-ux-piano-roll-note')).toHaveLength(3);
  });

  it('exposes data-note-id and data-midi on each note rect', () => {
    const { container } = render(() => (
      <PianoRollPreview
        notes={[makeNote({ startMs: 1000, midi: 72 })]}
        transients={[]}
      />
    ));
    const note = container.querySelector<HTMLDivElement>('.mic-ux-piano-roll-note');
    expect(note?.getAttribute('data-note-id')).toBe('n-1000-72-0');
    expect(note?.getAttribute('data-midi')).toBe('72');
  });

  it('renders drums as short coloured bars at the bottom row', () => {
    const { container } = render(() => (
      <PianoRollPreview
        notes={[]}
        transients={[
          makeTransient({ startMs: 500, type: 'kick' }),
          makeTransient({ startMs: 1000, type: 'snare' }),
          makeTransient({ startMs: 1500, type: 'hat' }),
          makeTransient({ startMs: 2000, type: 'click' }),
        ]}
      />
    ));
    const drums = container.querySelectorAll<HTMLDivElement>('.mic-ux-piano-roll-drum');
    expect(drums).toHaveLength(4);
    expect(drums[0]?.getAttribute('data-drum-type')).toBe('kick');
    expect(drums[1]?.getAttribute('data-drum-type')).toBe('snare');
    expect(drums[2]?.getAttribute('data-drum-type')).toBe('hat');
    expect(drums[3]?.getAttribute('data-drum-type')).toBe('click');
  });

  it('renders both notes and drums in the same preview', () => {
    const { container } = render(() => (
      <PianoRollPreview
        notes={[makeNote({ startMs: 500, midi: 60, durationMs: 200 })]}
        transients={[makeTransient({ startMs: 700, type: 'kick' })]}
      />
    ));
    expect(container.querySelectorAll('.mic-ux-piano-roll-note')).toHaveLength(1);
    expect(container.querySelectorAll('.mic-ux-piano-roll-drum')).toHaveLength(1);
  });
});

describe('PianoRollPreview — interaction', () => {
  it('fires onSelect with the synthesized id when a note is clicked', () => {
    let captured: string | null = null;
    const onSelect = (id: string): void => {
      captured = id;
    };
    const { container } = render(() => (
      <PianoRollPreview
        notes={[makeNote({ startMs: 1000, midi: 69, durationMs: 200 })]}
        transients={[]}
        onSelect={onSelect}
      />
    ));
    const note = container.querySelector<HTMLDivElement>('.mic-ux-piano-roll-note')!;
    fireEvent.click(note);
    expect(captured).toBe('n-1000-69-0');
  });

  it('fires onSelect when a drum bar is clicked', () => {
    let captured: string | null = null;
    const onSelect = (id: string): void => {
      captured = id;
    };
    const { container } = render(() => (
      <PianoRollPreview
        notes={[]}
        transients={[makeTransient({ startMs: 800, type: 'hat' })]}
        onSelect={onSelect}
      />
    ));
    const drum = container.querySelector<HTMLDivElement>('.mic-ux-piano-roll-drum')!;
    fireEvent.click(drum);
    expect(captured).toBe('d-800-hat-0');
  });

  it('does not throw when onSelect is omitted', () => {
    const { container } = render(() => (
      <PianoRollPreview
        notes={[makeNote({ startMs: 1000 })]}
        transients={[]}
      />
    ));
    const note = container.querySelector<HTMLDivElement>('.mic-ux-piano-roll-note')!;
    expect(() => fireEvent.click(note)).not.toThrow();
  });
});

describe('PianoRollPreview — selection', () => {
  it('marks selected notes via data-selected', () => {
    const { container } = render(() => (
      <PianoRollPreview
        notes={[
          makeNote({ startMs: 500, midi: 60, durationMs: 200 }),
          makeNote({ startMs: 1000, midi: 64, durationMs: 200 }),
        ]}
        transients={[]}
        selection={['n-500-60-0']}
      />
    ));
    const selected = container.querySelectorAll<HTMLDivElement>(
      '.mic-ux-piano-roll-note[data-selected="true"]',
    );
    expect(selected).toHaveLength(1);
    expect(selected[0]?.getAttribute('data-note-id')).toBe('n-500-60-0');
  });

  it('defaults selection to empty when prop is omitted', () => {
    const { container } = render(() => (
      <PianoRollPreview
        notes={[makeNote({ startMs: 1000, midi: 60 })]}
        transients={[]}
      />
    ));
    const selected = container.querySelectorAll(
      '.mic-ux-piano-roll-note[data-selected="true"]',
    );
    expect(selected).toHaveLength(0);
  });
});

describe('PianoRollPreview — accessibility metadata', () => {
  it('root exposes a descriptive aria-label', () => {
    const { container } = render(() => (
      <PianoRollPreview
        notes={[
          makeNote({ startMs: 500, midi: 60 }),
          makeNote({ startMs: 800, midi: 64 }),
          makeNote({ startMs: 1100, midi: 67 }),
        ]}
        transients={[
          makeTransient({ startMs: 600, type: 'kick' }),
          makeTransient({ startMs: 1000, type: 'snare' }),
        ]}
      />
    ));
    const root = container.querySelector('.mic-ux-piano-roll');
    expect(root?.getAttribute('role')).toBe('img');
    expect(root?.getAttribute('aria-label')).toBe('Piano roll preview: 3 notes, 2 onsets');
  });

  it('data-note-count and data-drum-count match the inputs', () => {
    const { container } = render(() => (
      <PianoRollPreview
        notes={[makeNote({ startMs: 500 }), makeNote({ startMs: 900 })]}
        transients={[makeTransient({ startMs: 700, type: 'hat' })]}
      />
    ));
    const root = container.querySelector('.mic-ux-piano-roll');
    expect(root?.getAttribute('data-note-count')).toBe('2');
    expect(root?.getAttribute('data-drum-count')).toBe('1');
  });
});
