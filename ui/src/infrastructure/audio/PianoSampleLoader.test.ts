import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('PianoSampleLoader — re-export of loadPianoSamples from SampleLoader', () => {
  let samplesMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    samplesMock = vi.fn().mockResolvedValue(undefined);
    vi.doMock('@strudel/webaudio', () => ({ samples: samplesMock }));
  });

  it('PianoSampleLoader delegates to SampleLoader (calls samples with piano manifest)', async () => {
    const { loadPianoSamples } = await import('./PianoSampleLoader');
    const p = loadPianoSamples();
    expect(samplesMock).toHaveBeenCalledTimes(1);
    expect(samplesMock).toHaveBeenCalledWith('/samples/piano/strudel.json');
    await p;
  });
});