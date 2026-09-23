import { Effect } from 'effect';
import type { AppState } from '~/domain/types';
import type { AppEnv } from '~/domain/services';
import { reduceAppEvent } from './reducer';

/**
 * Pure orchestration use-cases. Сводят reducer + сервисы в один Effect.
 * Возвращают новый AppState + список побочных эффектов (через Effect.fork).
 */

export const submitUserMessage = (
  state: AppState,
  text: string,
): Effect.Effect<readonly [AppState, ReadonlyArray<Effect.Effect<void, never, AppEnv>>], never, AppEnv> =>
  Effect.sync(() => {
    const afterUser = reduceAppEvent(state, { type: 'userMessage', text });
    const afterAgentStatus = reduceAppEvent(afterUser, { type: 'agentStatusChange', status: 'streaming' });

    const effects: Effect.Effect<void, never, AppEnv>[] = [];

    // TODO Phase 2: реальный LLM streamCompletion + tool calling.
    // Сейчас — заглушка, чтобы продемонстрировать wiring.
    effects.push(
      Effect.sync(() => {
        console.info('[useCase] would stream completion for:', text);
      }),
    );

    return [afterAgentStatus, effects] as const;
  });