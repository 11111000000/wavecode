import { Effect } from 'effect';
import { dispatch, appStore } from '../state/appStore';
import { AppLayer } from '~/infrastructure/composition';
import { AudioEngine } from '~/domain/services';
import { injectMix } from '~/application/useCases/injectMix';
import { evalWithTransport } from '~/application/useCases/evalWithTransport';
import {
  unlockAudioContext,
  testBeep,
} from '~/infrastructure/audio/LiveAudioEngine';

/**
 * Аудио-действия — общие для всех компонентов (header кнопки, etc).
 * Используют Effect + AppLayer напрямую, без передачи пропсов.
 */

export const evalScore = async (overrideScore?: string): Promise<void> => {
  const score = overrideScore ?? appStore.score;
  if (!score.trim()) {
    dispatch({ type: 'audioStatusChange', status: 'error', error: 'score is empty' });
    return;
  }
  unlockAudioContext();
  dispatch({ type: 'audioStatusChange', status: 'playing' });
  // Mixer side-state: gain/mute/solo — applied at eval time only,
  // never mutates the persisted score.
  const mixed = injectMix(score, appStore.layerMix);
  // Transport-side-effects (swing) применяются в обёртке — score
  // остаётся чистым, swing виден только на лету.
  const wrapped = evalWithTransport(mixed, appStore.transportState);
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const audio = yield* AudioEngine;
        yield* audio.eval(wrapped);
      }).pipe(Effect.provide(AppLayer)),
    );
  } catch (err) {
    dispatch({
      type: 'audioStatusChange',
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
    });
  }
};

export const stopAudio = async (): Promise<void> => {
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const audio = yield* AudioEngine;
        yield* audio.stop();
      }).pipe(Effect.provide(AppLayer)),
    );
    dispatch({ type: 'audioStatusChange', status: 'stopped' });
  } catch (err) {
    dispatch({
      type: 'audioStatusChange',
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
    });
  }
};

export const beep = (hz: number): void => testBeep(hz);
