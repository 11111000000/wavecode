import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('PianoSampleLoader (uses globalThis.samples from Strudel evalScope)', () => {
  let originalSamples: unknown;

  beforeEach(async () => {
    vi.resetModules();
    originalSamples = (globalThis as Record<string, unknown>).samples;
    (globalThis as Record<string, unknown>).samples = vi.fn();
  });

  afterEach(() => {
    if (originalSamples === undefined) {
      delete (globalThis as Record<string, unknown>).samples;
    } else {
      (globalThis as Record<string, unknown>).samples = originalSamples;
    }
  });

  it('registers the piano sample bank on first call', async () => {
    const { loadPianoSamples } = await import('./PianoSampleLoader');
    loadPianoSamples();
    const samplesFn = (globalThis as Record<string, unknown>).samples as ReturnType<typeof vi.fn>;
    expect(samplesFn).toHaveBeenCalledTimes(1);
    expect(samplesFn).toHaveBeenCalledWith({ piano: './samples/piano/' });
  });

  it('does not re-register on subsequent calls (idempotent)', async () => {
    const { loadPianoSamples } = await import('./PianoSampleLoader');
    loadPianoSamples();
    loadPianoSamples();
    loadPianoSamples();
    const samplesFn = (globalThis as Record<string, unknown>).samples as ReturnType<typeof vi.fn>;
    expect(samplesFn).toHaveBeenCalledTimes(1);
  });

  it('defers silently if globalThis.samples is not yet defined', async () => {
    delete (globalThis as Record<string, unknown>).samples;
    const { loadPianoSamples } = await import('./PianoSampleLoader');
    expect(() => loadPianoSamples()).not.toThrow();
    // After defer, no registration happened.
    (globalThis as Record<string, unknown>).samples = vi.fn();
    loadPianoSamples();
    const samplesFn = (globalThis as Record<string, unknown>).samples as ReturnType<typeof vi.fn>;
    expect(samplesFn).toHaveBeenCalledTimes(1);
  });
});
