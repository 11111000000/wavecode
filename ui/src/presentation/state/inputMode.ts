import { createSignal } from 'solid-js';

/**
 * inputMode — режим входного дока.
 *
 * wavecode-zen-minimal-ui (ревизия 2, пункт 10): голос и ритм — два
 * явных режима ОДНОГО входного дока. Переключатель «Голос | Ритм»
 * живёт в доке; плавающая кнопка одна и знает, в каком режиме она
 * находится.
 *
 *   voice  — микрофон → распознавание речи → правка партитуры
 *   rhythm — счёт темпа и тап-сетка → ритмический паттерн
 *
 * Отдельный store (а не поле в voiceAIStore), потому что режим ввода
 * шире голоса: оркестратор распознавания не должен знать про ритм.
 */
export type InputMode = 'voice' | 'rhythm';

const [inputMode, setInputModeRaw] = createSignal<InputMode>('voice');
const [inputDockOpen, setInputDockOpen] = createSignal(false);

export const getInputMode = inputMode;
export const isInputDockOpen = inputDockOpen;

export const setInputMode = (mode: InputMode): void => {
  setInputModeRaw(mode);
};

/** Открыть док ввода; без аргумента — в текущем режиме. */
export const openInputDock = (mode?: InputMode): void => {
  if (mode) setInputModeRaw(mode);
  setInputDockOpen(true);
};

export const closeInputDock = (): void => {
  setInputDockOpen(false);
};

export const toggleInputDock = (): void => {
  setInputDockOpen((v) => !v);
};
