import { describe, it, expect } from 'vitest';
import { parseStackTopLayers } from './parseStack';

describe('parseStackTopLayers', () => {
  it('returns an empty array for empty or whitespace-only input', () => {
    expect(parseStackTopLayers('')).toEqual([]);
    expect(parseStackTopLayers('   \n\n  ')).toEqual([]);
  });

  it('treats a single bare pattern as one layer', () => {
    const layers = parseStackTopLayers('note("c3 e3 g3")');
    expect(layers).toHaveLength(1);
    expect(layers[0]?.index).toBe(0);
    expect(layers[0]?.source).toBe('note("c3 e3 g3")');
    expect(layers[0]?.name).toBe('Piano');
  });

  it('splits a flat stack into N layers', () => {
    const score = [
      'stack(',
      '  note("c3").gain(0.4),',
      '  s("bd sd").gain(0.5),',
      '  n("0 1 2").gain(0.3),',
      ')',
    ].join('\n');
    const layers = parseStackTopLayers(score);
    expect(layers).toHaveLength(3);
    expect(layers[0]?.name).toBe('Piano');
    expect(layers[1]?.name).toBe('Samples');
    expect(layers[2]?.name).toBe('Arp');
    expect(layers[1]?.source).toBe('s("bd sd").gain(0.5)');
  });

  it('handles the Creep preset (6 layers)', () => {
    const creep = [
      '// Creep (Radiohead) — G → B → C → Cm, indie-rock с Hendrix-style аранжировкой',
      'stack(',
      '  // Chord pad — voicing() берёт chord-name → Tonal/Chord-symbol, даёт правильную инверсию',
      '  chord("<G B C Cm>").voicing().s("triangle").gain(0.18).lpf(1500).room(.3),',
      '  // Acoustic guitar arpeggio — sawtooth + slight shape() эмулирует string',
      '  note("<g3 b3 d4 b3 c4 b3 c4 ees4 / e3 g3 c4 g3 e3 g3 c4 g3>").s("sawtooth").shape(0.3).gain(0.12).lpf(2500).room(.4),',
      '  // Bass — root notes, G2/B2/C3/C3',
      '  note("<g2 b2 c3 c3>").s("sawtooth").gain(0.4).lpf(300),',
      '  // Acoustic kit: kick на 1/3, snare backbeat, 8th-note hihat',
      '  s("drums_bd ~ drums_bd ~").gain(0.55),',
      '  s("~ drums_sd ~ drums_sd").gain(0.28),',
      '  s("drums_hh*8").decay(.04).sustain(0).gain(0.15)',
      ')',
    ].join('\n');
    const layers = parseStackTopLayers(creep);
    expect(layers).toHaveLength(6);
    expect(layers.map((l) => l.name)).toEqual([
      'chord',
      'Piano',
      'Bass (g2)',
      'Samples',
      'Samples',
      'Samples',
    ]);
  });

  it('handles a nested stack at top level (treats nested stack as one layer)', () => {
    const score = 'stack(note("c3"), stack(s("a"), s("b")), s("x"))';
    const layers = parseStackTopLayers(score);
    expect(layers).toHaveLength(3);
    expect(layers[1]?.name).toBe('Sub-stack');
  });

  it('does not split on commas inside nested parens', () => {
    const score = 'stack(s("<a, b, c>"), n("0,1,2"))';
    const layers = parseStackTopLayers(score);
    expect(layers).toHaveLength(2);
    expect(layers[0]?.source).toBe('s("<a, b, c>")');
    expect(layers[1]?.source).toBe('n("0,1,2")');
  });

  it('ignores commas inside string and template-literal boundaries', () => {
    const score = 'stack(s("a,b,c"), n(`0,1,2`), s(\'x,y\'))';
    const layers = parseStackTopLayers(score);
    expect(layers).toHaveLength(3);
    expect(layers[0]?.source).toBe('s("a,b,c")');
    expect(layers[1]?.source).toBe('n(`0,1,2`)');
    expect(layers[2]?.source).toBe("s('x,y')");
  });

  it('skips empty slots between consecutive commas', () => {
    const score = 'stack(s("a"), , s("b"),, s("c"))';
    const layers = parseStackTopLayers(score);
    expect(layers).toHaveLength(3);
    expect(layers.map((l) => l.name)).toEqual(['Samples', 'Samples', 'Samples']);
  });

  it('handles multi-line stack bodies with line comments', () => {
    const score = [
      'stack(',
      '  // hi-hat',
      '  s("hh*8"),',
      '  // kick',
      '  s("bd"),',
      ')',
    ].join('\n');
    const layers = parseStackTopLayers(score);
    expect(layers).toHaveLength(2);
    expect(layers[0]?.name).toBe('Samples');
    expect(layers[1]?.name).toBe('Samples');
  });

  it('handles stack with no leading whitespace and single-line body', () => {
    const layers = parseStackTopLayers('stack(s("a"),s("b"))');
    expect(layers).toHaveLength(2);
    expect(layers[0]?.source).toBe('s("a")');
    expect(layers[1]?.source).toBe('s("b")');
  });

  it('detects named fallback for non-strudel call', () => {
    const layers = parseStackTopLayers('stack(myFn("a"), other())');
    expect(layers[0]?.name).toBe('myFn');
    expect(layers[1]?.name).toBe('other');
  });
});
