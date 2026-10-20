/**
 * selectSttLayer tests — the decision table only. No DOM probing
 * here on purpose: `resolveSttEngine` takes capabilities as an
 * argument precisely so the "which browser gets which engine" rule
 * can be checked without simulating iOS Safari.
 */

import { describe, it, expect } from 'vitest';
import {
  parseSttBackend,
  resolveSttEngine,
  type SttCapabilities,
} from './selectSttLayer';

const caps = (web: boolean, server: boolean): SttCapabilities => ({ web, server });

describe('selectSttLayer — parseSttBackend', () => {
  it('defaults to auto for an unset or unrecognised value', () => {
    expect(parseSttBackend(undefined)).toBe('auto');
    expect(parseSttBackend('')).toBe('auto');
    expect(parseSttBackend('nonsense')).toBe('auto');
  });

  it('accepts the explicit overrides, case- and space-insensitively', () => {
    expect(parseSttBackend('web')).toBe('web');
    expect(parseSttBackend(' SERVER ')).toBe('server');
  });
});

describe('selectSttLayer — resolveSttEngine', () => {
  it('auto keeps the cloud path wherever Web Speech exists', () => {
    // Chrome desktop, Chrome Android — the 1-2 s path stays.
    expect(resolveSttEngine('auto', caps(true, true))).toBe('web');
    expect(resolveSttEngine('auto', caps(true, false))).toBe('web');
  });

  it('auto falls back to the server where Web Speech is missing', () => {
    // iOS Safari, Firefox.
    expect(resolveSttEngine('auto', caps(false, true))).toBe('server');
  });

  it('auto reports none only when the browser can do neither', () => {
    expect(resolveSttEngine('auto', caps(false, false))).toBe('none');
  });

  it('an explicit override never silently switches engines', () => {
    // Debugging value: forcing `web` on Firefox must fail loudly in
    // the UI instead of quietly becoming the server relay.
    expect(resolveSttEngine('web', caps(false, true))).toBe('none');
    expect(resolveSttEngine('server', caps(true, false))).toBe('none');
    expect(resolveSttEngine('web', caps(true, false))).toBe('web');
    expect(resolveSttEngine('server', caps(false, true))).toBe('server');
  });
});