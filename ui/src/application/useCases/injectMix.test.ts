import { describe, it, expect } from 'vitest';
import { injectMix } from './injectMix';
import { makeLayerMix, type LayerMix } from '~/domain/types';

const mix = (i: number, partial: Partial<LayerMix> = {}): LayerMix => ({
  ...makeLayerMix(i),
  ...partial,
});

describe('injectMix', () => {
  it('returns the score unchanged for empty input', () => {
    expect(injectMix('', [])).toBe('');
    expect(injectMix('   ', [])).toBe('   ');
  });

  it('returns the score unchanged when no stack and no layerMix', () => {
    const score = 'note("c3")';
    expect(injectMix(score, [])).toBe(score);
  });

  it('replaces existing .gain(X) with new value (no other behavior change)', () => {
    const score = 'stack(s("a").gain(0.5), s("b").gain(0.3))';
    const out = injectMix(score, [
      mix(0, { gain: 0.7 }),
      mix(1, { gain: 0.2 }),
    ]);
    expect(out).toBe('stack(s("a").gain(0.7), s("b").gain(0.2))');
  });

  it('appends .gain(X) when a layer has no existing .gain()', () => {
    const score = 'stack(s("a"), s("b").slow(2))';
    const out = injectMix(score, [
      mix(0, { gain: 0.6 }),
      mix(1, { gain: 0.4 }),
    ]);
    expect(out).toBe('stack(s("a").gain(0.6), s("b").slow(2).gain(0.4))');
  });

  it('rewrites .gain() for a single bare pattern (no stack wrapper)', () => {
    const score = 'note("c3").gain(0.5)';
    const out = injectMix(score, [mix(0, { gain: 0.8 })]);
    expect(out).toBe('note("c3").gain(0.8)');
  });

  it('appends .gain() for a single bare pattern without existing gain', () => {
    const score = 's("bd sd")';
    const out = injectMix(score, [mix(0, { gain: 0.5 })]);
    expect(out).toBe('s("bd sd").gain(0.5)');
  });

  it('forces muted layers to .gain(0)', () => {
    const score = 'stack(s("a").gain(0.5), s("b").gain(0.5))';
    const out = injectMix(score, [
      mix(0, { gain: 0.7, muted: true }),
      mix(1, { gain: 0.7 }),
    ]);
    expect(out).toBe('stack(s("a").gain(0), s("b").gain(0.7))');
  });

  it('solo cascade: soloed layer passes through, non-soloed → .gain(0)', () => {
    const score = 'stack(s("a").gain(0.5), s("b").gain(0.5), s("c").gain(0.5))';
    const out = injectMix(score, [
      mix(0, { gain: 0.4, soloed: true }),
      mix(1, { gain: 0.4, muted: false }),
      mix(2, { gain: 0.4, muted: false }),
    ]);
    expect(out).toBe('stack(s("a").gain(0.4), s("b").gain(0), s("c").gain(0))');
  });

  it('multiple soloed layers all pass through; non-soloed → .gain(0)', () => {
    const score = 'stack(s("a"), s("b"), s("c"))';
    const out = injectMix(score, [
      mix(0, { soloed: true }),
      mix(1, { gain: 0.3 }),
      mix(2, { soloed: true }),
    ]);
    expect(out).toBe('stack(s("a").gain(1), s("b").gain(0), s("c").gain(1))');
  });

  it('solo overrides mute on the same layer (solo wins, gain stays)', () => {
    const score = 'stack(s("a"))';
    const out = injectMix(score, [mix(0, { gain: 0.5, muted: true, soloed: true })]);
    // soloActive = true, layer is soloed → not muted, gain stays 0.5
    expect(out).toBe('stack(s("a").gain(0.5))');
  });

  it('clamps gains to a sane range (no Infinity or negative values)', () => {
    const score = 'stack(s("a"), s("b"))';
    const out = injectMix(score, [
      mix(0, { gain: 99 }),
      mix(1, { gain: -1 }),
    ]);
    expect(out).toBe('stack(s("a").gain(1.5), s("b").gain(0))');
  });

  it('leaves layers without a mixer entry untouched', () => {
    const score = 'stack(s("a").gain(0.5), s("b").gain(0.5), s("c").gain(0.5))';
    const out = injectMix(score, [mix(0, { gain: 0.9 })]);
    expect(out).toBe('stack(s("a").gain(0.9), s("b").gain(0.5), s("c").gain(0.5))');
  });

  it('preserves nested parens and string commas when splitting', () => {
    const score = 'stack(s("<a, b>").gain(0.1), n("0,1,2").gain(0.2))';
    const out = injectMix(score, [
      mix(0, { gain: 0.6 }),
      mix(1, { gain: 0.7 }),
    ]);
    expect(out).toBe('stack(s("<a, b>").gain(0.6), n("0,1,2").gain(0.7))');
  });

  it('preserves the head and tail of the score (comments, whitespace, semicolons)', () => {
    const score = [
      '// intro',
      'stack(',
      '  s("a").gain(0.5),',
      '  s("b")',
      ') // outro',
    ].join('\n');
    const out = injectMix(score, [mix(0, { gain: 0.9 }), mix(1, { gain: 0.4 })]);
    expect(out).toContain('// intro');
    expect(out).toContain('// outro');
    expect(out).toContain('s("a").gain(0.9)');
    expect(out).toContain('s("b").gain(0.4)');
  });

  it('preserves empty slots between commas', () => {
    const score = 'stack(s("a"), , s("b"))';
    const out = injectMix(score, [mix(0, { gain: 0.5 }), mix(1, { gain: 0.6 })]);
    // Empty slot kept; two real layers get .gain()
    expect(out).toBe('stack(s("a").gain(0.5), , s("b").gain(0.6))');
  });

  it('handles a stack with all layers muted', () => {
    const score = 'stack(s("a"), s("b"))';
    const out = injectMix(score, [
      mix(0, { muted: true }),
      mix(1, { muted: true }),
    ]);
    expect(out).toBe('stack(s("a").gain(0), s("b").gain(0))');
  });

  it('handles the Creep preset end-to-end', () => {
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
    const mix6: ReadonlyArray<LayerMix> = [
      mix(0, { gain: 0.8 }),
      mix(1, { gain: 0.6 }),
      mix(2, { gain: 0.4 }),
      mix(3, { gain: 1.0 }),
      mix(4, { gain: 0.5, muted: true }),
      mix(5, { gain: 0.7 }),
    ];
    const out = injectMix(creep, mix6);
    // Each layer's last numeric .gain() is replaced.
    // Layer 0 (chord pad) — `.gain(0.18)` replaced with `.gain(0.8)`
    expect(out).toContain('chord("<G B C Cm>").voicing().s("triangle").gain(0.8).lpf(1500).room(.3)');
    // Layer 1 (arpeggio) — `.gain(0.12)` replaced with `.gain(0.6)`
    expect(out).toContain('.gain(0.6).lpf(2500)');
    // Layer 2 (bass) — `.gain(0.4)` kept (mix asked for 0.4 too)
    expect(out).toContain('note("<g2 b2 c3 c3>").s("sawtooth").gain(0.4).lpf(300)');
    // Layer 3 (kick) — `.gain(0.55)` replaced with `.gain(1)`
    expect(out).toContain('s("drums_bd ~ drums_bd ~").gain(1)');
    // Layer 4 (snare, muted) — forced to `.gain(0)`
    expect(out).toContain('s("~ drums_sd ~ drums_sd").gain(0)');
    // Layer 5 (hihat) — `.gain(0.15)` replaced with `.gain(0.7)`
    expect(out).toContain('s("drums_hh*8").decay(.04).sustain(0).gain(0.7)');
    // First layer's gain is no longer the original 0.18
    expect(out).not.toContain('gain(0.18)');
  });
});
