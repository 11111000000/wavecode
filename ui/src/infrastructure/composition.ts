import { Layer } from 'effect';
import { MockLLMClient } from './llm/MockLLMClient';
import { LiveAudioEngine } from './audio/LiveAudioEngine';
import { MockRepo } from './repo/MockRepo';
import type { AppEnv } from '~/domain/services';

/**
 * Composition Root: собирает все Layers в один AppEnv.
 * Phase 2b: MockAudioEngine → LiveAudioEngine (real Strudel).
 * TODO Phase 2a: MockLLMClient → LiveLLMClient (real AI SDK).
 * TODO Phase 3:   MockRepo → IDBRepo (real IndexedDB).
 */

export const AppLayer: Layer.Layer<AppEnv, never, never> = Layer.mergeAll(
  MockLLMClient,
  LiveAudioEngine,
  MockRepo,
);