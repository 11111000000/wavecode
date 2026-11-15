import { describe, it, expect, vi } from 'vitest';
import { LiveParamController } from './liveParams';
import type { LiveParam, LiveParamName } from '~/domain/services';

/**
 * LiveParamController — the live-parameter path of the camera
 * hand-gesture feature (Phase 0).
 *
 * The controller is unit-tested WITHOUT a real AudioContext (the vitest
 * env is jsdom, where `AudioContext` does not exist): the gain node and
 * the clock are injected, so a fake AudioParam-like object is enough.
 *
 * `LiveAudioEngine` is deliberately NOT imported here — it would pull
 * `@strudel/*` into jsdom.
 */

type FakeParam = {
  value: number;
  setTargetAtTime: ReturnType<typeof vi.fn>;
  setValueAtTime: ReturnType<typeof vi.fn>;
};

const makeFakeGain = (): { param: FakeParam; node: GainNode } => {
  const param: FakeParam = {
    value: 1,
    setTargetAtTime: vi.fn(),
    setValueAtTime: vi.fn(),
  };
  return { param, node: { gain: param } as unknown as GainNode };
};

const master = (
  param: LiveParamName,
  value: number,
  rampMs = 0,
): LiveParam => ({
  scope: { scope: 'master' },
  param,
  value,
  rampMs,
});

const NOW = 42;

describe('LiveParamController — clamping', () => {
  it('clamps gain into 0..1.5', () => {
    const { param, node } = makeFakeGain();
    const ctrl = new LiveParamController({ getGainNode: () => node, getNow: () => NOW });

    ctrl.set(master('gain', 5));
    expect(param.setValueAtTime).toHaveBeenLastCalledWith(1.5, NOW);
    expect(ctrl.getValue('gain')).toBe(1.5);

    ctrl.set(master('gain', -3));
    expect(param.setValueAtTime).toHaveBeenLastCalledWith(0, NOW);
    expect(ctrl.getValue('gain')).toBe(0);
  });

  it('clamps the other parameters into their ranges', () => {
    const { node } = makeFakeGain();
    const ctrl = new LiveParamController({ getGainNode: () => node, getNow: () => NOW });

    ctrl.set(master('cutoff', 5));
    expect(ctrl.getValue('cutoff')).toBe(20);
    ctrl.set(master('cutoff', 999999));
    expect(ctrl.getValue('cutoff')).toBe(20000);
    ctrl.set(master('hcutoff', 1));
    expect(ctrl.getValue('hcutoff')).toBe(20);
    ctrl.set(master('room', 4));
    expect(ctrl.getValue('room')).toBe(1);
    ctrl.set(master('room', -1));
    expect(ctrl.getValue('room')).toBe(0);
    ctrl.set(master('speed', 0.1));
    expect(ctrl.getValue('speed')).toBe(0.25);
    ctrl.set(master('speed', 100));
    expect(ctrl.getValue('speed')).toBe(4);
  });
});

describe('LiveParamController — immediate vs smoothed', () => {
  it('applies immediately with setValueAtTime when rampMs is 0', () => {
    const { param, node } = makeFakeGain();
    const ctrl = new LiveParamController({ getGainNode: () => node, getNow: () => NOW });

    ctrl.set(master('gain', 0.5, 0));

    expect(param.setValueAtTime).toHaveBeenCalledTimes(1);
    expect(param.setValueAtTime).toHaveBeenCalledWith(0.5, NOW);
    expect(param.setTargetAtTime).not.toHaveBeenCalled();
  });

  it('smooths with setTargetAtTime and rampMs/1000/3 as timeConstant', () => {
    const { param, node } = makeFakeGain();
    const ctrl = new LiveParamController({ getGainNode: () => node, getNow: () => NOW });

    ctrl.set(master('gain', 0.5, 300));

    expect(param.setTargetAtTime).toHaveBeenCalledTimes(1);
    expect(param.setTargetAtTime).toHaveBeenCalledWith(0.5, NOW, expect.closeTo(0.1, 10));
    expect(param.setValueAtTime).not.toHaveBeenCalled();
  });

  it('never lets the timeConstant fall below 0.001', () => {
    const { param, node } = makeFakeGain();
    const ctrl = new LiveParamController({ getGainNode: () => node, getNow: () => NOW });

    ctrl.set(master('gain', 0.5, 1));

    expect(param.setTargetAtTime).toHaveBeenCalledWith(0.5, NOW, 0.001);
  });
});

describe('LiveParamController — no gain node yet', () => {
  it('stores the value and applies it once the node appears', () => {
    const { param, node } = makeFakeGain();
    let current: GainNode | null = null;
    const ctrl = new LiveParamController({ getGainNode: () => current, getNow: () => NOW });

    ctrl.set(master('gain', 0.4, 0));

    // Nothing to apply to yet — but the value is remembered.
    expect(param.setValueAtTime).not.toHaveBeenCalled();
    expect(ctrl.getValue('gain')).toBe(0.4);

    // The node appears (superdough creates its controller on the first
    // trigger) → the stored value is applied.
    current = node;
    ctrl.reapply();

    expect(param.setValueAtTime).toHaveBeenCalledTimes(1);
    expect(param.setValueAtTime).toHaveBeenCalledWith(0.4, NOW);
  });

  it('applies a stored value on the next set() as well', () => {
    const { param, node } = makeFakeGain();
    let current: GainNode | null = null;
    const ctrl = new LiveParamController({ getGainNode: () => current, getNow: () => NOW });

    ctrl.set(master('gain', 0.4, 0));
    expect(param.setValueAtTime).not.toHaveBeenCalled();

    current = node;
    ctrl.set(master('gain', 0.7, 0));

    expect(param.setValueAtTime).toHaveBeenLastCalledWith(0.7, NOW);
  });

  it('does not throw when the gain-node getter throws', () => {
    const ctrl = new LiveParamController({
      getGainNode: () => {
        throw new Error('no audio yet');
      },
      getNow: () => NOW,
    });

    expect(() => ctrl.set(master('gain', 0.5, 0))).not.toThrow();
    expect(ctrl.getValue('gain')).toBe(0.5);
  });
});

describe('LiveParamController — bad input', () => {
  it('ignores non-finite values and keeps the last one', () => {
    const { param, node } = makeFakeGain();
    const ctrl = new LiveParamController({ getGainNode: () => node, getNow: () => NOW });

    ctrl.set(master('gain', 0.5, 0));
    param.setValueAtTime.mockClear();

    ctrl.set(master('gain', Number.NaN, 0));
    ctrl.set(master('gain', Number.POSITIVE_INFINITY, 0));
    ctrl.set(master('gain', Number.NEGATIVE_INFINITY, 0));

    expect(param.setValueAtTime).not.toHaveBeenCalled();
    expect(ctrl.getValue('gain')).toBe(0.5);
  });
});

describe('LiveParamController — reset', () => {
  it('returns the master gain to 1 and clears the stored values', () => {
    const { param, node } = makeFakeGain();
    const ctrl = new LiveParamController({ getGainNode: () => node, getNow: () => NOW });

    ctrl.set(master('gain', 0.25, 0));
    ctrl.set(master('room', 0.5, 0));
    expect(ctrl.getValue('gain')).toBe(0.25);

    ctrl.reset();

    // The reset is RAMPED (not a jump): an instant jump back to unity clicks.
    expect(param.setTargetAtTime).toHaveBeenLastCalledWith(1, NOW, 0.02);
    expect(param.setValueAtTime).not.toHaveBeenCalledWith(1, NOW);
    expect(ctrl.getValue('gain')).toBeUndefined();
    expect(ctrl.getValue('room')).toBeUndefined();
  });

  it('does not throw when there is no gain node', () => {
    const ctrl = new LiveParamController({ getGainNode: () => null, getNow: () => NOW });
    expect(() => ctrl.reset()).not.toThrow();
  });
});

describe('LiveParamController — layer scope', () => {
  it('is a safe no-op for a layer-scoped request', () => {
    const { param, node } = makeFakeGain();
    const ctrl = new LiveParamController({ getGainNode: () => node, getNow: () => NOW });

    expect(() =>
      ctrl.set({
        scope: { scope: 'layer', index: 2 },
        param: 'gain',
        value: 0.1,
        rampMs: 0,
      }),
    ).not.toThrow();

    expect(param.setValueAtTime).not.toHaveBeenCalled();
    expect(param.setTargetAtTime).not.toHaveBeenCalled();
    expect(ctrl.getValue('gain')).toBeUndefined();
  });
});

describe('LiveParamController — params without a reachable node', () => {
  it('accepts cutoff/room/speed but does not apply them to any node', () => {
    const { param, node } = makeFakeGain();
    const ctrl = new LiveParamController({ getGainNode: () => node, getNow: () => NOW });

    ctrl.set(master('cutoff', 800, 50));
    ctrl.set(master('room', 0.3, 50));
    ctrl.set(master('speed', 2, 50));

    // superdough's per-voice FX nodes are internal — there is no node to
    // write to, so nothing is applied.
    expect(param.setValueAtTime).not.toHaveBeenCalled();
    expect(param.setTargetAtTime).not.toHaveBeenCalled();

    // The request is still remembered (clamped).
    expect(ctrl.getValue('cutoff')).toBe(800);
    expect(ctrl.getValue('room')).toBe(0.3);
    expect(ctrl.getValue('speed')).toBe(2);
  });
});
