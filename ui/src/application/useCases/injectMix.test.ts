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
      'stack(',
      '  note("<g2 b2 c3 c3>").s("sawtooth").gain(0.4).lpf(300),',
      '  note("<[55,59,62] [59,63,66] [60,64,67] [60,63,67]>").s("triangle").gain(0.2).lpf(1500),',
      '  n("<55 67 59 67 62 67 59 67>*2").s("sawtooth").gain(0.12).lpf(1500),',
      '  s("sbd ~ sbd ~").gain(0.5),',
      '  s("~ white ~ white").decay(.05).sustain(0).gain(0.22),',
      '  s("white*8").decay(.04).sustain(0).gain(0.15)',
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
    expect(out).toContain('.gain(0.8).lpf(300)');
    expect(out).toContain('.gain(0.6).lpf(1500)');
    // The drum layer had .gain(0.5) → .gain(1) (clamped but actually 1.0)
    expect(out).toContain('s("sbd ~ sbd ~").gain(1)');
    // The muted layer (index 4) is forced to 0
    expect(out).toContain('s("~ white ~ white").decay(.05).sustain(0).gain(0)');
    expect(out).toContain('s("white*8").decay(.04).sustain(0).gain(0.7)');
    // First two layers' gains are not the originals
    expect(out).not.toContain('.gain(0.4).lpf(300)');
    expect(out).not.toContain('.gain(0.2).lpf(1500)');
  });
});
