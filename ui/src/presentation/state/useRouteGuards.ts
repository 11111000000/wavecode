import { Effect } from 'effect';
import { AppLayer } from '~/infrastructure/composition';
import { Repo } from '~/domain/services';
import { dispatch } from './appStore';
import { addCustomPreset, resetAllBrowserData } from './presetsStore';
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

/**
 * Создать новую композицию: именованный custom-пресет (см.
 * `addCustomPreset`), активный пресет переключается на него,
 * score заменяется, история диалогов очищается. Без подтверждения —
 * используется из лендинга, где юзер уже явно нажал «Создать».
 *
 * Возвращает id нового пресета — нужно Hero/bridge'у, чтобы при
 * желании можно было сразу вписать его в ?preset=… параметр.
 *
 * Если `initialScore` пуст/undefined, в качестве стартового
 * содержимого берётся NEW_COMPOSITION_TEMPLATE — единая точка
 * истины, чтобы «новая композиция» выглядела одинаково и в
 * Toolbar-«Новая», и из лендинга.
 */
export const createNewComposition = (initialScore?: string): string => {
  void stopAudio();
  const preset = addCustomPreset(initialScore ?? NEW_COMPOSITION_TEMPLATE);
  setSelectedPresetPersist(preset.id);
  dispatch({ type: 'switchPreset', id: preset.id });
  dispatch({ type: 'replaceScore', text: preset.score });
  dispatch({ type: 'clearMessages' });
  return preset.id;
};

export const useRouteGuards = (): RouteGuards => {
  const onNew = (): void => {
    if (!confirmNew()) return;
    createNewComposition();
  };

  const onResetAll = (): void => {
    if (!confirmReset()) return;
    resetAllBrowserData();
    resetSelectedPreset();
    // activePresetId в appStore тоже к 'creep' (а не остаётся
    // указывать на удалённый ранее custom-*). Иначе useAutoSave
    // через 500мс перезапишет IDB.value activePresetId=Default.creep.
    dispatch({ type: 'switchPreset', id: 'creep' });
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
