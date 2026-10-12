import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  wrapStrudelLogger,
  applyVoicingAliases,
  applyBankAliasFallback,
  DEFAULT_BANK_FALLBACKS,
  type TonalModule,
  type WebaudioModule,
} from './strudelPatches';

describe('wrapStrudelLogger', () => {
  let originalLog: typeof console.log;
  let originalError: typeof console.error;

  beforeEach(() => {
    originalLog = console.log;
    originalError = console.error;
  });

  afterEach(() => {
    console.log = originalLog;
    console.error = originalError;
    vi.restoreAllMocks();
  });

  it('routes strudel-flavoured logs through console.error, stripping %c', () => {
    wrapStrudelLogger();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Don't mock console.log — the wrapper installed by wrapStrudelLogger
    // needs to run with its real body. vi.spyOn adds a hook without
    // replacing the function, but we explicitly skip interception here.
    const logSpy = vi.spyOn(console, 'log');

    console.log(
      '%c[getTrigger] error: sound drums not found!',
      'background-color: black;color:white;border-radius:15px',
    );

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      '[getTrigger] error: sound drums not found!',
    );
    // The wrapper still records console.log calls (we put a spy on it).
    expect(logSpy).toHaveBeenCalled();
  });

  it('forwards non-strudel console.log calls untouched', () => {
    wrapStrudelLogger();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    console.log('plain message');
    console.log('format %s here', 'value');
    // Note: '%cstyled' with 'color: red' — colour:<x> is in the heuristic
    // (matches /color:\s*white/) only for white specifically, so this
    // falls through to the original log.
    console.log('%cstyled', 'color: red');
    console.log('count:', 42);

    expect(logSpy).toHaveBeenCalledTimes(4);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('is idempotent — calling wrap twice does not double-wrap', () => {
    wrapStrudelLogger();
    const firstWrapped = console.log;
    wrapStrudelLogger();
    expect(console.log).toBe(firstWrapped);
  });
});

describe('applyVoicingAliases', () => {
  it('injects maj7→^7 and min7→m7 into every voicing dictionary', () => {
    const dictionary: Record<string, readonly string[]> = {
      m7: ['3m 5P 7m 9M'],
      '^7': ['3M 5P 7M 9M'],
    };
    const dict2: Record<string, readonly string[]> = {
      m7: ['2P 5P 9M'],
      '^7': ['3M 7M 9M 12P'],
    };
    const tonal: TonalModule = {
      voicingRegistry: {
        ireal: { dictionary },
        'ireal-ext': { dictionary: dict2 },
      },
    };

    const added = applyVoicingAliases(tonal);

    expect(added).toBeGreaterThanOrEqual(4); // maj7, min7 in both dicts + extras
    expect(dictionary.min7).toEqual(dictionary.m7);
    expect(dictionary.maj7).toEqual(dictionary['^7']);
    expect(dict2.min7).toEqual(dict2.m7);
    expect(dict2.maj7).toEqual(dict2['^7']);
  });

  it('does not overwrite existing entries', () => {
    const dictionary: Record<string, readonly string[]> = {
      m7: ['3m 5P 7m 9M'],
      '^7': ['3M 5P 7M 9M'],
      maj7: ['CUSTOM maj7 voicing'],
      min7: ['CUSTOM min7 voicing'],
    };
    const tonal: TonalModule = {
      voicingRegistry: { ireal: { dictionary } },
    };

    applyVoicingAliases(tonal);

    expect(dictionary.maj7).toEqual(['CUSTOM maj7 voicing']);
    expect(dictionary.min7).toEqual(['CUSTOM min7 voicing']);
  });

  it('is no-op when registry is empty', () => {
    const tonal: TonalModule = { voicingRegistry: {} };
    expect(applyVoicingAliases(tonal)).toBe(0);
  });

  it('is no-op when registry is missing', () => {
    const tonal: TonalModule = {};
    expect(applyVoicingAliases(tonal)).toBe(0);
  });

  it('only adds an alias when the source key exists in the same dictionary', () => {
    const dictionary = { m7: ['3m 5P 7m 9M'] } as Record<string, readonly string[]>;
    const tonal: TonalModule = { voicingRegistry: { minimal: { dictionary } } };

    const added = applyVoicingAliases(tonal);

    // ^7 isn't in this dict, so maj7 alias should NOT be added; only min7
    // resolves.
    expect(dictionary.min7).toEqual(dictionary.m7);
    expect(dictionary.maj7).toBeUndefined();
    expect(added).toBe(1);
  });
});

describe('applyBankAliasFallback', () => {
  it('registers drums→drums_bd, piano→piano_a4, synth→synth_bass-c2 when keys exist', () => {
    const dict: Record<string, { onTrigger: unknown; data: unknown }> = {
      drums_bd: { onTrigger: () => {}, data: {} },
      piano_a4: { onTrigger: () => {}, data: {} },
      'synth_bass-c2': { onTrigger: () => {}, data: {} },
    };
    const soundMap = {
      get: () => dict,
      set: vi.fn(),
    };
    const webaudio: WebaudioModule = { soundMap };

    const added = applyBankAliasFallback(webaudio);

    expect(added).toEqual(expect.arrayContaining(['drums', 'piano', 'synth', 'drum']));
    expect(added).not.toContain('drum_bd'); // sanity: no fabricated names
    expect(soundMap.set).toHaveBeenCalledTimes(1);
    const setSpy = soundMap.set as ReturnType<typeof vi.fn>;
    const newDict = setSpy.mock.calls[0]?.[0] as typeof dict;
    expect(newDict.drums).toBe(dict.drums_bd);
    expect(newDict.drum).toBe(dict.drums_bd);
    expect(newDict.piano).toBe(dict.piano_a4);
    expect(newDict.synth).toBe(dict['synth_bass-c2']);
  });

  it('does nothing when every bank-name slot is already present', () => {
    const dict: Record<string, { onTrigger: unknown; data: unknown }> = {
      drums: { onTrigger: () => {}, data: {} },
      drum: { onTrigger: () => {}, data: {} },
      piano: { onTrigger: () => {}, data: {} },
      synth: { onTrigger: () => {}, data: {} },
      drums_bd: { onTrigger: () => {}, data: {} },
      piano_a4: { onTrigger: () => {}, data: {} },
      'synth_bass-c2': { onTrigger: () => {}, data: {} },
    };
    const soundMap = { get: () => dict, set: vi.fn() };
    const webaudio: WebaudioModule = { soundMap };

    const added = applyBankAliasFallback(webaudio);

    expect(added).toEqual([]);
    expect(soundMap.set).not.toHaveBeenCalled();
  });

  it('is a no-op when the fallback sound key is missing', () => {
    const dict: Record<string, { onTrigger: unknown; data: unknown }> = {};
    const soundMap = { get: () => dict, set: vi.fn() };
    const webaudio: WebaudioModule = { soundMap };

    const added = applyBankAliasFallback(webaudio);

    expect(added).toEqual([]);
    expect(soundMap.set).not.toHaveBeenCalled();
  });

  it('accepts a custom fallback map', () => {
    const dict: Record<string, { onTrigger: unknown; data: unknown }> = {
      drums_bd: { onTrigger: 'a', data: 'b' },
      piano_a4: { onTrigger: 'c', data: 'd' },
    };
    const soundMap = { get: () => dict, set: vi.fn() };
    const webaudio: WebaudioModule = { soundMap };

    const added = applyBankAliasFallback(webaudio, { kick: 'drums_bd', grand: 'piano_a4' });

    expect(added).toEqual(['kick', 'grand']);
  });

  it('DEFAULT_BANK_FALLBACKS matches the union of expected bare names', () => {
    expect(Object.keys(DEFAULT_BANK_FALLBACKS)).toEqual(
      expect.arrayContaining(['drums', 'drum', 'piano', 'synth']),
    );
  });
});
