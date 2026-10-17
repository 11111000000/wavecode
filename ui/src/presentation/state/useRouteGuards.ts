import { Effect } from 'effect';
import { AppLayer } from '~/infrastructure/composition';
import { Repo } from '~/domain/services';
import { dispatch } from './appStore';
import { resetAllBrowserData } from './presetsStore';
import { resetSelectedPreset, setSelectedPresetPersist } from './selectedPreset';
import { stopAudio } from './audioActions';

const NEW_COMPOSITION_TEMPLATE = '// Начни новую композицию здесь\n';

export const confirmNew = (): boolean => window.confirm(
  'Создать новую композицию?\nТекущая партитура и история диалога сбросятся.',
);

export const confirmReset = (): boolean => window.confirm(
  'Сбросить ВСЕ настройки и очистить локальное хранилище?\n(localStorage + IDB score/messages)',
);

export type RouteGuards = {
  readonly confirmNew: typeof confirmNew;
  readonly confirmReset: typeof confirmReset;
  readonly onNew: () => void;
  readonly onResetAll: () => void;
};

export const useRouteGuards = (): RouteGuards => {
  const onNew = (): void => {
    if (!confirmNew()) return;
    void stopAudio();
    dispatch({ type: 'replaceScore', text: NEW_COMPOSITION_TEMPLATE });
    dispatch({ type: 'clearMessages' });
    setSelectedPresetPersist('creep');
  };

  const onResetAll = (): void => {
    if (!confirmReset()) return;
    resetAllBrowserData();
    resetSelectedPreset();
    void Effect.runPromise(
      Effect.gen(function* () {
        const repo = yield* Repo;
        yield* repo.saveScore('');
        yield* repo.saveDialogs({});
        yield* repo.saveActivePresetId('creep');
      }).pipe(Effect.provide(AppLayer)),
    ).then(() => window.location.reload());
  };

  return { confirmNew, confirmReset, onNew, onResetAll };
};
