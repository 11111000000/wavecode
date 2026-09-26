import { Layer } from 'effect';
import { MockLLMClient } from './llm/MockLLMClient';
import { makeLiveLLMClient } from './llm/LiveLLMClient';
import { LiveAudioEngine } from './audio/LiveAudioEngine';
import { MockRepo } from './repo/MockRepo';
import type { AppEnv } from '~/domain/services';

/**
 * Composition Root: собирает все Layers в один AppEnv.
 * LiveAudioEngine — real Strudel в main thread.
 * makeLiveLLMClient — real @ai-sdk/openai-compatible → llm.kosov.online.
 *   Fallback to MockLLMClient if VITE_LLM_PROXY_KEY is not set.
 * TODO Phase 3: MockRepo → IDBRepo (real IndexedDB).
 */

export const AppLayer: Layer.Layer<AppEnv, never, never> = Layer.mergeAll(
  // Use real LLM client if key is set, otherwise mock for offline dev.
  import.meta.env.VITE_LLM_PROXY_KEY
    ? makeLiveLLMClient()
    : MockLLMClient,
  LiveAudioEngine,
  MockRepo,
);