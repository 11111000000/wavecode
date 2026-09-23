import { Effect, Layer, type Context } from 'effect';
import { AudioEngine } from '~/domain/services';

/**
 * Mock AudioEngine. Логирует вызовы вместо реального Strudel eval.
 * В Phase 2b заменяется на LiveAudioEngine (@strudel/webaudio).
 */

const impl: Context.Tag.Service<typeof AudioEngine> = {
  eval: (snippet: string) =>
    Effect.sync(() => {
      console.info('[mock audio] eval:', snippet.slice(0, 80), snippet.length > 80 ? '…' : '');
    }),
  stop: () => Effect.void,
};

export const MockAudioEngine: Layer.Layer<AudioEngine, never, never> = Layer.succeed(
  AudioEngine,
  impl as never,
);