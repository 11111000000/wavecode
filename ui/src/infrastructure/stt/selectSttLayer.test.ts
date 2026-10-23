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
  it('defaults to server for an unset or unrecognised value', () => {
    // `server` is the default on purpose: `auto` resolves to the
    // cloud recogniser on every Chrome, where the recogniser object
    // exists but emits nothing, so the fallback watchdog burned
    // ~3 s of dead air on every single press. See the module header.
    expect(parseSttBackend(undefined)).toBe('server');
    expect(parseSttBackend('')).toBe('server');
    expect(parseSttBackend('nonsense')).toBe('server');
  });

  it('accepts the explicit overrides, case- and space-insensitively', () => {
    expect(parseSttBackend('web')).toBe('web');
    expect(parseSttBackend('auto')).toBe('auto');
    expect(parseSttBackend(' SERVER ')).toBe('server');
  });
});

describe('selectSttLayer — resolveSttEngine', () => {
  it('server — the default — never touches the cloud recogniser', () => {
    // Even where Web Speech would resolve, an explicit `server` (and
    // therefore also the default) must not pick it. This is the
    // privacy guarantee: our microphone audio stays on angara-1.
    expect(resolveSttEngine('server', caps(true, true))).toBe('server');
    expect(resolveSttEngine('server', caps(true, false))).toBe('none');
  });

  it('auto keeps the cloud path wherever Web Speech exists', () => {
    // Chrome desktop, Chrome Android — the 1-2 s path stays available
    // for anyone who opts into it with VITE_STT_BACKEND=auto.
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