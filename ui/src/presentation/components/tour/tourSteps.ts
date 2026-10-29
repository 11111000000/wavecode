/**
 * Welcome-tour step definitions.
 *
 * Five steps in fixed order. Each step references an EXISTING
 * selector where possible (`.cm-content` from CodeMirror,
 * `[data-ai-textarea]` from AIEditPanel,
 * `.wc-overflow-menu` from OverflowMenu,
 * `[data-testid="transport-play-btn"]` from TransportBar); the
 * play button gets an additional `data-tour="play"` attribute
 * (one-line edit to TransportBar.tsx) so the selector survives
 * future testid renames.
 *
 * `position` controls where the tooltip card lands relative to
 * the spotlight: `top` = card above the highlighted element,
 * `bottom` = below, `left` = on the left, `right` = on the right.
 *
 * Copy is Russian to match the rest of the UI.
 */

export type TourPosition = 'top' | 'bottom' | 'left' | 'right';

export type TourStep = {
  readonly id: string;
  readonly target: string;
  readonly title: string;
  readonly body: string;
  readonly position: TourPosition;
};

export const TOUR_STEPS: ReadonlyArray<TourStep> = [
  {
    id: 'play',
    target: '[data-tour="play"]',
    title: 'Нажми ▶',
    body: 'Чтобы услышать первый звук — играет «creep» по умолчанию.',
    position: 'top',
  },
  {
    id: 'edit',
    target: '.cm-content',
    title: 'Поменяй что-нибудь',
    body: 'Любая нота или цифра — и музыка меняется сразу.',
    position: 'bottom',
  },
  {
    id: 'ai',
    target: '[data-ai-textarea]',
    title: 'Попроси ИИ',
    body: 'Напиши: «сделай бит» — ИИ сам поправит код.',
    position: 'top',
  },
  {
    id: 'save',
    target: '.wc-overflow-menu',
    title: 'Сохрани пресет',
    body: 'Нажми ⋯ в правом верхнем углу → «Сохранить пресет», чтобы не потерять.',
    position: 'bottom',
  },
  {
    id: 'done',
    target: 'body',
    title: 'Готово!',
    body: 'Теперь ты умеешь всё основное. Удачи в написании музыки.',
    position: 'top',
  },
];