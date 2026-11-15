import { createSignal } from 'solid-js';
import { dispatch, appStore } from './appStore';
import { getPreset, saveCustomPreset } from './presetsStore';
import { getSelectedPresetId, setSelectedPresetPersist } from './selectedPreset';
import { evalScore } from './audioActions';

/**
 * presetActions — операции над композициями в ОДНОМ месте.
 *
 * wavecode-zen-ui-phases-6-7 (фаза 6): выбор композиции уехал из
 * транспортной строки в лист «Инструменты» (см. PresetPicker.tsx) —
 * строка транспорта теперь это ровно «play · темп · позиция».
 * Чтобы логика не разъехалась между App.tsx и листом, она живёт
 * здесь: и App, и лист зовут одни и те же функции.
 *
 * Черновик имени новой композиции тоже здесь: раньше его состояние
 * жило в App.tsx и показывалось полосой под транспортом. Теперь он
 * живёт рядом с выбором композиции — там, где пользователь ищет
 * композиции.
 */

const [draftName, setDraftName] = createSignal('');
const [draftOpen, setDraftOpen] = createSignal(false);

export const presetDraft = {
  /** Имя новой композиции, которое пользователь набирает. */
  name: draftName,
  /** Показывать ли поле ввода имени. */
  open: draftOpen,
  setName: (v: string): void => { setDraftName(v); },
  setOpen: (v: boolean): void => { setDraftOpen(v); },
};

/**
 * Загрузить композицию: сменить активный пресет, подставить его код
 * в редактор и сразу его сыграть.
 */
export const loadPresetById = (id: string): void => {
  const preset = getPreset(id);
  if (!preset) return;
  setSelectedPresetPersist(id);
  dispatch({ type: 'switchPreset', id });
  dispatch({ type: 'replaceScore', text: preset.score });
  void evalScore();
};

/**
 * Сохранить текущий код как свою композицию и сразу переключиться
 * на неё. Пустое имя — отказ.
 */
export const savePresetDraft = (): void => {
  const name = draftName().trim();
  if (!name) return;
  const preset = saveCustomPreset(name, appStore.score);
  setSelectedPresetPersist(preset.id);
  dispatch({ type: 'switchPreset', id: preset.id });
  setDraftOpen(false);
  setDraftName('');
};

/** Текущая выбранная композиция (реактивно). */
export const currentPresetId = getSelectedPresetId;
