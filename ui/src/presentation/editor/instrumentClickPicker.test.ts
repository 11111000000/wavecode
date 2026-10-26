import { describe, it, expect } from 'vitest';
import { soundArgumentAt } from './instrumentClickPicker';

/**
 * The click-to-pick-instrument heuristic.
 *
 * The editor has no parser, so the question "is this a sound name?"
 * is answered by looking at the string literal the click landed in
 * and checking that the literal is the argument of an `s(` / `.s(`
 * call. Everything else — a note name, a function call, a number —
 * must be left alone, or the editor would open a picker on every
 * click.
 */

describe('soundArgumentAt', () => {
  it('finds the sound name in a .s("…") call', () => {
    const doc = 'note("c4").s("piano")';
    const pos = doc.indexOf('piano') + 2;
    expect(soundArgumentAt(doc, pos)).toEqual({
      from: doc.indexOf('piano'),
      to: doc.indexOf('piano') + 'piano'.length,
      current: 'piano',
    });
  });

  it('finds the sound name in a bare s("…") call', () => {
    const doc = 's("drums_hh*8")';
    const pos = doc.indexOf('drums_hh') + 3;
    expect(soundArgumentAt(doc, pos)?.current).toBe('drums_hh');
  });

  it('keeps the hyphen of a drum name in the token', () => {
    const doc = 's("drums_bd-sub")';
    const pos = doc.indexOf('bd-sub') + 2;
    expect(soundArgumentAt(doc, pos)?.current).toBe('drums_bd-sub');
  });

  it('ignores a note name inside a note() call', () => {
    const doc = 'note("c4 e4")';
    expect(soundArgumentAt(doc, doc.indexOf('c4') + 1)).toBeNull();
  });

  it('ignores a string that is not a sound argument', () => {
    const doc = 'note("c4").gain("0.5")';
    expect(soundArgumentAt(doc, doc.indexOf('0.5') + 1)).toBeNull();
  });

  it('ignores a sound name outside any string', () => {
    const doc = 'piano';
    expect(soundArgumentAt(doc, 2)).toBeNull();
  });

  it('finds the name in the second line of a multi-line score', () => {
    const doc = 'stack(\n  note("c4").s("synth_pad"),\n)';
    const pos = doc.indexOf('synth_pad') + 4;
    expect(soundArgumentAt(doc, pos)?.current).toBe('synth_pad');
  });
});
