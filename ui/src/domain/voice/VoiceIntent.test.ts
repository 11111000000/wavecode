/**
 * VoiceIntent tagged-union tests: pin the discriminator set and
 * the type-guard narrowing.
 *
 * These mostly exist for compile-time exhaustiveness (a missing
 * `kind` would break the type-guard block). The runtime checks
 * are paranoid but cheap.
 */

import { describe, it, expect } from 'vitest';
import {
  type ClarifyIntent,
  type EditScoreIntent,
  type HelpIntent,
  type PresetIntent,
  type SystemIntent,
  type TransportIntent,
  type VoiceIntent,
  type WhistleIntent,
  isClarifyIntent,
  isEditScoreIntent,
  isHelpIntent,
  isPresetIntent,
  isSystemIntent,
  isTransportIntent,
  isWhistleIntent,
} from './VoiceIntent';

const stamp = 1_700_000_000_000;

describe('VoiceIntent type guards', () => {
  it('discriminates edit-score', () => {
    const i: VoiceIntent = {
      kind: 'edit-score',
      instruction: 'add bass',
      confidence: 0.9,
      timestampMs: stamp,
    } satisfies EditScoreIntent;
    expect(isEditScoreIntent(i)).toBe(true);
    expect(isTransportIntent(i)).toBe(false);
    expect(isWhistleIntent(i)).toBe(false);
  });

  it('discriminates transport (with optional value)', () => {
    const i: VoiceIntent = {
      kind: 'transport',
      action: 'play',
      value: 0.5,
      timestampMs: stamp,
    } satisfies TransportIntent;
    expect(isTransportIntent(i)).toBe(true);
    expect(isEditScoreIntent(i)).toBe(false);
  });

  it('discriminates preset / system / whistle / help / clarify', () => {
    const preset: VoiceIntent = {
      kind: 'preset',
      action: 'load',
      target: 'creep',
      timestampMs: stamp,
    } satisfies PresetIntent;
    const system: VoiceIntent = {
      kind: 'system',
      action: 'undo',
      timestampMs: stamp,
    } satisfies SystemIntent;
    const whistle: VoiceIntent = {
      kind: 'whistle',
      mode: 'capture',
      timestampMs: stamp,
    } satisfies WhistleIntent;
    const help: VoiceIntent = {
      kind: 'help',
      query: 'how do I add swing',
      timestampMs: stamp,
    } satisfies HelpIntent;
    const clarify: VoiceIntent = {
      kind: 'clarify',
      question: 'did you mean add bass to the stack?',
      timestampMs: stamp,
    } satisfies ClarifyIntent;
    expect(isPresetIntent(preset)).toBe(true);
    expect(isSystemIntent(system)).toBe(true);
    expect(isWhistleIntent(whistle)).toBe(true);
    expect(isHelpIntent(help)).toBe(true);
    expect(isClarifyIntent(clarify)).toBe(true);

    // Cross-checks: a preset is NOT a transport, etc.
    expect(isTransportIntent(preset)).toBe(false);
    expect(isEditScoreIntent(system)).toBe(false);
  });

  it('exhaustive narrowing — a switch over every kind compiles', () => {
    const render = (i: VoiceIntent): string => {
      switch (i.kind) {
        case 'edit-score':
          return `edit:${i.instruction}`;
        case 'clarify':
          return `q:${i.question}`;
        case 'transport':
          return `t:${i.action}`;
        case 'preset':
          return `p:${i.action}:${i.target}`;
        case 'system':
          return `s:${i.action}`;
        case 'whistle':
          return `w:${i.mode}`;
        case 'help':
          return `h:${i.query}`;
      }
    };
    expect(
      render({
        kind: 'edit-score',
        instruction: 'make louder',
        confidence: 0.9,
        timestampMs: stamp,
      }),
    ).toBe('edit:make louder');
    expect(
      render({
        kind: 'transport',
        action: 'stop',
        timestampMs: stamp,
      }),
    ).toBe('t:stop');
  });
});
