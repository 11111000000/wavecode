import { createSignal } from 'solid-js';
import { closeKindSheet, getKindSnap, openKindSheet } from './uiState';

/**
 * inputMode — три модальности ввода и единственная точка входа в них.
 *
 * wavecode-unified-input-entry: раньше в приложении было ЧЕТЫРЕ
 * кнопки ввода, разложенных по трём местам:
 *
 *   - плавающая круглая «Голос» — она же REC, она же тап-пад в ритме;
 *   - пункт рельса «Ввод» — открывал тот же самый док;
 *   - пункт листа «Инструменты» «Микрофон» — а это был свист;
 *   - переключатель «Голос | Ритм» в доке.
 *
 * Пользователь не мог отличить «голос записывает мелодию» от
 * «микрофон снимает высоту тона»: обе кнопки назывались устройством,
 * а различались только местом в интерфейсе.
 *
 * Теперь:
 *
 *   speech  — микрофон → распознавание речи → текст → «→ В ИИ»
 *   whistle — микрофон → определение высоты → MIDI-ноты и удары
 *   rhythm  — простукивание сетки → ритмический паттерн
 *
 * Модальности называются по НАМЕРЕНИЮ («что я сейчас делаю»), а не по
 * устройству («микрофон»): устройство одно, а смыслов два, и развести
 * их по названию кнопки было невозможно в принципе.
 *
 * Лист ввода — единственная точка входа. Пункт «Ввод» ушёл из рельса
 * в tier 2 (лист «Инструменты» + ⌘K), плавающая кнопка открывает
 * лист ввода и всегда означает одно и то же: «открыть ввод».
 */
export type InputMode = 'speech' | 'whistle' | 'rhythm';

/** Порядок вкладок в листе ввода. */
export const INPUT_MODES: readonly InputMode[] = ['speech', 'whistle', 'rhythm'];

const [inputMode, setInputModeRaw] = createSignal<InputMode>('speech');

export const getInputMode = inputMode;

export const setInputMode = (mode: InputMode): void => {
  setInputModeRaw(mode);
};

/** Открыт ли лист ввода. */
export const isInputSheetOpen = (): boolean => getKindSnap('input') !== 'closed';

/** Открыть лист ввода; без аргумента — на текущей модальности. */
export const openInputSheet = (mode?: InputMode): void => {
  if (mode) setInputModeRaw(mode);
  openKindSheet('input', 'half');
};

export const closeInputSheet = (): void => {
  closeKindSheet('input');
};
