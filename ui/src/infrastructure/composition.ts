import { Layer } from 'effect';
import { makeLiveLLMClient } from './llm/LiveLLMClient';
import { LiveAudioEngine } from './audio/LiveAudioEngine';
import { IDBRepo } from './repo/IDBRepo';
import type { AppEnv } from '~/domain/services';

/**
 * Composition Root: собирает все Layers в один AppEnv.
 *
 * LiveLLMClient — raw fetch к llm.kosov.online/v1 (LiteLLM proxy).
 * LiveAudioEngine — реальный @strudel/webaudio в main thread.
 * IDBRepo — IndexedDB через idb-keyval (autosave score + messages).
 */

const llmLayer = import.meta.env.VITE_LLM_PROXY_KEY
  ? makeLiveLLMClient()
  : (console.warn('[wavecode] VITE_LLM_PROXY_KEY is not set; LLM calls will fail until configured.'),
    makeLiveLLMClient({ apiKey: '' }));

export const AppLayer: Layer.Layer<AppEnv, never, never> = Layer.mergeAll(
  llmLayer,
  LiveAudioEngine,
  IDBRepo,
);
