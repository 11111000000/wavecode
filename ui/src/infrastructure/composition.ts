import { Layer } from 'effect';
import { MockLLMClient } from './llm/MockLLMClient';
import { MockAudioEngine } from './audio/MockAudioEngine';
import { MockRepo } from './repo/MockRepo';
import type { AppEnv } from '~/domain/services';

/**
 * Composition Root: собирает все Layers в один AppEnv.
 * В Phase 2/3 здесь подменяем MockLLMClient → LiveLLMClient,
 * MockAudioEngine → LiveAudioEngine, MockRepo → IDBRepo.
 */

export const AppLayer: Layer.Layer<AppEnv, never, never> = Layer.mergeAll(
  MockLLMClient,
  MockAudioEngine,
  MockRepo,
);