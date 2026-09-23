import { Effect, Layer } from 'effect';
import { AudioEngine } from '~/domain/services';

/**
 * Mock AudioEngine. Логирует вызовы вместо реального Strudel eval.
 * В Phase 2 заменяется на LiveAudioEngine (Web Worker + @strudel/core).
 */

export const MockAudioEngine: Layer.Layer<AudioEngine, never, never> = Layer.succeed(
  AudioEngine,
  {
    eval: (snippet: string) =>
      Effect.sync(() => {
        console.info('[mock audio] eval:', snippet.slice(0, 80), snippet.length > 80 ? '…' : '');
      }),
    stop: () => Effect.void,
  },
);