import type { JSX } from 'solid-js';

type Props = {
  size?: number;
  class?: string;
  children?: JSX.Element;
};

const base = (size: number): JSX.SvgSVGAttributes<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': 1.5,
  'stroke-linecap': 'round' as const,
  'stroke-linejoin': 'round' as const,
  'aria-hidden': 'true',
});

export const PlayIcon = (p: Props): JSX.Element => (
  <svg {...base(p.size ?? 14)} class={`wc-icon ${p.class ?? ''}`}>
    <path d="M3 2 L13 8 L3 14 Z" fill="currentColor" stroke="none" />
  </svg>
);

export const StopIcon = (p: Props): JSX.Element => (
  <svg {...base(p.size ?? 14)} class={`wc-icon ${p.class ?? ''}`}>
    <rect x="2.5" y="2.5" width="11" height="11" fill="currentColor" stroke="none" />
  </svg>
);

export const RecordIcon = (p: Props): JSX.Element => (
  <svg {...base(p.size ?? 14)} class={`wc-icon ${p.class ?? ''}`}>
    <circle cx="8" cy="8" r="5" fill="currentColor" stroke="none" />
  </svg>
);

export const StepIcon = (p: Props): JSX.Element => (
  <svg {...base(p.size ?? 14)} class={`wc-icon ${p.class ?? ''}`}>
    <rect x="2" y="2" width="4" height="4" />
    <rect x="10" y="2" width="4" height="4" fill="currentColor" stroke="none" />
    <rect x="2" y="10" width="4" height="4" fill="currentColor" stroke="none" />
    <rect x="10" y="10" width="4" height="4" />
  </svg>
);

export const PianoIcon = (p: Props): JSX.Element => (
  <svg {...base(p.size ?? 14)} class={`wc-icon ${p.class ?? ''}`}>
    <rect x="2" y="3" width="12" height="10" />
    <line x1="6" y1="3" x2="6" y2="13" />
    <line x1="10" y1="3" x2="10" y2="13" />
    <rect x="3" y="3" width="2" height="6" fill="currentColor" stroke="none" />
    <rect x="7" y="3" width="2" height="6" fill="currentColor" stroke="none" />
    <rect x="11" y="3" width="2" height="6" fill="currentColor" stroke="none" />
  </svg>
);

export const SaveIcon = (p: Props): JSX.Element => (
  <svg {...base(p.size ?? 14)} class={`wc-icon ${p.class ?? ''}`}>
    <path d="M2 2 L10 2 L14 6 L14 14 L2 14 Z" />
    <path d="M5 2 L5 7 L11 7 L11 2" />
    <rect x="5" y="9" width="6" height="4" />
  </svg>
);

export const TrashIcon = (p: Props): JSX.Element => (
  <svg {...base(p.size ?? 14)} class={`wc-icon ${p.class ?? ''}`}>
    <path d="M2 4 L14 4" />
    <path d="M6 4 L6 2 L10 2 L10 4" />
    <path d="M3.5 4 L4.5 13 L11.5 13 L12.5 4" />
    <line x1="6.5" y1="6.5" x2="6.5" y2="11" />
    <line x1="9.5" y1="6.5" x2="9.5" y2="11" />
  </svg>
);

export const ShareIcon = (p: Props): JSX.Element => (
  <svg {...base(p.size ?? 14)} class={`wc-icon ${p.class ?? ''}`}>
    <circle cx="4" cy="8" r="2" />
    <circle cx="12" cy="3" r="2" />
    <circle cx="12" cy="13" r="2" />
    <line x1="5.5" y1="7" x2="10.5" y2="4" />
    <line x1="5.5" y1="9" x2="10.5" y2="12" />
  </svg>
);

export const UndoIcon = (p: Props): JSX.Element => (
  <svg {...base(p.size ?? 14)} class={`wc-icon ${p.class ?? ''}`}>
    <path d="M3 7 L6 4 L3 1" />
    <path d="M6 4 L10 4 Q13 4 13 7 L13 11 Q13 14 10 14 L9 14" />
  </svg>
);

export const RedoIcon = (p: Props): JSX.Element => (
  <svg {...base(p.size ?? 14)} class={`wc-icon ${p.class ?? ''}`}>
    <path d="M13 7 L10 4 L13 1" />
    <path d="M10 4 L6 4 Q3 4 3 7 L3 11 Q3 14 6 14 L7 14" />
  </svg>
);

export const ResetIcon = (p: Props): JSX.Element => (
  <svg {...base(p.size ?? 14)} class={`wc-icon ${p.class ?? ''}`}>
    <path d="M2 8 A6 6 0 1 1 8 14" />
    <polyline points="2 4 2 8 6 8" />
  </svg>
);

export const NewIcon = (p: Props): JSX.Element => (
  <svg {...base(p.size ?? 14)} class={`wc-icon ${p.class ?? ''}`}>
    <line x1="8" y1="2" x2="8" y2="14" />
    <line x1="2" y1="8" x2="14" y2="8" />
    <line x1="3.5" y1="3.5" x2="12.5" y2="12.5" />
    <line x1="12.5" y1="3.5" x2="3.5" y2="12.5" />
  </svg>
);

export const PhoneIcon = (p: Props): JSX.Element => (
  <svg {...base(p.size ?? 14)} class={`wc-icon ${p.class ?? ''}`}>
    <rect x="4" y="1" width="8" height="14" rx="0.5" />
    <line x1="4" y1="3.5" x2="12" y2="3.5" />
    <circle cx="8" cy="12.5" r="0.5" fill="currentColor" stroke="none" />
  </svg>
);

/** Layout swap: два прямоугольника один над другим + двунаправленная стрелка.
 *  Используется в TopBar для toggle code-primary ↔ ai-primary. */
export const LayoutSwapIcon = (p: Props): JSX.Element => (
  <svg {...base(p.size ?? 20)} class={`wc-icon ${p.class ?? ''}`}>
    <rect x="2" y="2" width="12" height="3.5" rx="0.5" />
    <rect x="2" y="10.5" width="12" height="3.5" rx="0.5" />
    <line x1="8" y1="6" x2="8" y2="10" />
    <polyline points="6 8 8 10 10 8" />
    <polyline points="6 8 8 6 10 8" opacity="0.6" />
  </svg>
);

export const SpeakerIcon = (p: Props): JSX.Element => (
  <svg {...base(p.size ?? 14)} class={`wc-icon ${p.class ?? ''}`}>
    <path d="M2 6 L5 6 L8 3 L8 13 L5 10 L2 10 Z" />
    <path d="M10 5 Q13 8 10 11" />
  </svg>
);

export const CloseIcon = (p: Props): JSX.Element => (
  <svg {...base(p.size ?? 16)} class={`wc-icon ${p.class ?? ''}`}>
    <line x1="3.5" y1="3.5" x2="12.5" y2="12.5" />
    <line x1="12.5" y1="3.5" x2="3.5" y2="12.5" />
  </svg>
);

/** Expand chevron (sheet collapsed → tap to expand). Points up = развернуть. */
export const ExpandIcon = (p: Props): JSX.Element => (
  <svg {...base(p.size ?? 16)} class={`wc-icon ${p.class ?? ''}`}>
    <polyline points="3 6 8 11 13 6" />
  </svg>
);

/** Collapse chevron (sheet full → tap to collapse). Points down = свернуть. */
export const CollapseIcon = (p: Props): JSX.Element => (
  <svg {...base(p.size ?? 16)} class={`wc-icon ${p.class ?? ''}`}>
    <polyline points="3 10 8 5 13 10" />
  </svg>
);

export const PlusIcon = (p: Props): JSX.Element => (
  <svg {...base(p.size ?? 16)} class={`wc-icon ${p.class ?? ''}`}>
    <line x1="8" y1="2" x2="8" y2="14" />
    <line x1="2" y1="8" x2="14" y2="8" />
  </svg>
);

export const ChevronLeftIcon = (p: Props): JSX.Element => (
  <svg {...base(p.size ?? 16)} class={`wc-icon ${p.class ?? ''}`}>
    <polyline points="10 3 5 8 10 13" />
  </svg>
);

export const ChevronRightIcon = (p: Props): JSX.Element => (
  <svg {...base(p.size ?? 16)} class={`wc-icon ${p.class ?? ''}`}>
    <polyline points="6 3 11 8 6 13" />
  </svg>
);

export const ChevronUpIcon = (p: Props): JSX.Element => (
  <svg {...base(p.size ?? 16)} class={`wc-icon ${p.class ?? ''}`}>
    <polyline points="3 10 8 5 13 10" />
  </svg>
);

export const ChevronDownIcon = (p: Props): JSX.Element => (
  <svg {...base(p.size ?? 16)} class={`wc-icon ${p.class ?? ''}`}>
    <polyline points="3 6 8 11 13 6" />
  </svg>
);

export const SettingsIcon = (p: Props): JSX.Element => (
  <svg {...base(p.size ?? 16)} class={`wc-icon ${p.class ?? ''}`}>
    <circle cx="8" cy="8" r="2.5" />
    <path d="M8 1.5 L8 3.5 M8 12.5 L8 14.5 M1.5 8 L3.5 8 M12.5 8 L14.5 8 M3.5 3.5 L5 5 M11 11 L12.5 12.5 M3.5 12.5 L5 11 M11 5 L12.5 3.5" />
  </svg>
);

export const TabScoreIcon = (p: Props): JSX.Element => (
  <svg {...base(p.size ?? 18)} class={`wc-icon ${p.class ?? ''}`}>
    <line x1="3" y1="5" x2="13" y2="5" />
    <line x1="3" y1="8" x2="13" y2="8" />
    <line x1="3" y1="11" x2="13" y2="11" />
    <circle cx="5" cy="5" r="0.6" fill="currentColor" stroke="none" />
    <circle cx="9" cy="8" r="0.6" fill="currentColor" stroke="none" />
    <circle cx="11" cy="11" r="0.6" fill="currentColor" stroke="none" />
  </svg>
);

export const TabChatIcon = (p: Props): JSX.Element => (
  <svg {...base(p.size ?? 18)} class={`wc-icon ${p.class ?? ''}`}>
    <path d="M2.5 3 L13.5 3 Q14.5 3 14.5 4 L14.5 10 Q14.5 11 13.5 11 L6 11 L3 13.5 L3 11 Q2 11 2 10 L2 4 Q2 3 2.5 3 Z" />
    <line x1="5" y1="6" x2="11" y2="6" />
    <line x1="5" y1="8" x2="9" y2="8" />
  </svg>
);

export const TabMixerIcon = (p: Props): JSX.Element => (
  <svg {...base(p.size ?? 18)} class={`wc-icon ${p.class ?? ''}`}>
    <line x1="4" y1="2" x2="4" y2="14" />
    <line x1="8" y1="2" x2="8" y2="14" />
    <line x1="12" y1="2" x2="12" y2="14" />
    <rect x="2" y="5" width="4" height="2" fill="currentColor" stroke="none" />
    <rect x="6" y="9" width="4" height="2" fill="currentColor" stroke="none" />
    <rect x="10" y="3" width="4" height="2" fill="currentColor" stroke="none" />
  </svg>
);

export const TabStatusIcon = (p: Props): JSX.Element => (
  <svg {...base(p.size ?? 18)} class={`wc-icon ${p.class ?? ''}`}>
    <circle cx="8" cy="8" r="5" />
    <circle cx="8" cy="8" r="2" fill="currentColor" stroke="none" />
  </svg>
);

export const DragHandleIcon = (p: Props): JSX.Element => (
  <svg {...base(p.size ?? 24)} class={`wc-icon ${p.class ?? ''}`}>
    <line x1="8" y1="5" x2="8" y2="5.01" />
    <line x1="8" y1="11" x2="8" y2="11.01" />
  </svg>
);

/** Console / bug icon — terminal-propt with antennae.
 *  Используется для фиксированной кнопки ConsoleButton. */
export const ConsoleIcon = (p: Props): JSX.Element => (
  <svg {...base(p.size ?? 20)} class={`wc-icon ${p.class ?? ''}`}>
    <rect x="2.5" y="4" width="11" height="9" rx="1.2" />
    <line x1="4.5" y1="7" x2="11.5" y2="7" />
    <line x1="4.5" y1="10" x2="11.5" y2="10" />
    <circle cx="5" cy="4" r="0.6" fill="currentColor" stroke="none" />
    <circle cx="8" cy="4" r="0.6" fill="currentColor" stroke="none" />
    <circle cx="11" cy="4" r="0.6" fill="currentColor" stroke="none" />
    <line x1="5.5" y1="13" x2="5.5" y2="14.5" />
    <line x1="10.5" y1="13" x2="10.5" y2="14.5" />
    <line x1="4" y1="14.5" x2="12" y2="14.5" />
  </svg>
);

/** Pin icon — означает sticky (нет auto-dismiss). */
export const PinIcon = (p: Props): JSX.Element => (
  <svg {...base(p.size ?? 14)} class={`wc-icon ${p.class ?? ''}`}>
    <path d="M8 1.5 L8 6 M5.5 6 L10.5 6 M6 9 L10 9 M8 9 L8 14.5" />
  </svg>
);

/**
 * Severity icons — paired с цветами severity-tokens в `.toast-icon`.
 * 24×24 viewBox (немного крупнее штатных 16px иконок) для читаемости в
 * маленьком квадрате `.toast-icon`. color-blind accessibility: иконка +
 * цвет = два независимых канала; см. Toast.tsx.
 */

/** InfoIcon — круг с буквой 'i' (informational hint). */
export const InfoIcon = (p: Props): JSX.Element => (
  <svg {...base(p.size ?? 16)} class={`wc-icon ${p.class ?? ''}`}>
    <circle cx="8" cy="8" r="6.25" />
    <circle cx="8" cy="5" r="0.7" fill="currentColor" stroke="none" />
    <line x1="8" y1="7.2" x2="8" y2="11.5" />
  </svg>
);

/** WarnIcon — треугольник с восклицательным знаком (warning). */
export const WarnIcon = (p: Props): JSX.Element => (
  <svg {...base(p.size ?? 16)} class={`wc-icon ${p.class ?? ''}`}>
    <path d="M8 2 L14.5 13 L1.5 13 Z" />
    <line x1="8" y1="6" x2="8" y2="9.8" />
    <circle cx="8" cy="11.5" r="0.7" fill="currentColor" stroke="none" />
  </svg>
);

/** ErrorIcon — круг с крестом (soft error). */
export const ErrorIcon = (p: Props): JSX.Element => (
  <svg {...base(p.size ?? 16)} class={`wc-icon ${p.class ?? ''}`}>
    <circle cx="8" cy="8" r="6.25" />
    <line x1="5.2" y1="5.2" x2="10.8" y2="10.8" />
    <line x1="10.8" y1="5.2" x2="5.2" y2="10.8" />
  </svg>
);

/**
 * CriticalIcon — восьмиугольник (octagon) с восклицательным знаком.
 * Восьмиугольник — международный символ «stop / critical» (как
 * знак STOP на дороге), визуально отличается от WarnIcon's
 * triangle. Используется для severity critical и fatal (последняя
 * в consoleStore обрабатывается идентично critical).
 */
export const CriticalIcon = (p: Props): JSX.Element => (
  <svg {...base(p.size ?? 16)} class={`wc-icon ${p.class ?? ''}`}>
    <path d="M5 1.5 L11 1.5 L14.5 5 L14.5 11 L11 14.5 L5 14.5 L1.5 11 L1.5 5 Z" />
    <line x1="8" y1="4.5" x2="8" y2="9.5" />
    <circle cx="8" cy="11.5" r="0.7" fill="currentColor" stroke="none" />
  </svg>
);

/**
 * WavecodeLogo — square 48×48 spectrum-tile logo: amber→cyan→magenta
 * gradient waveform on a slate rounded-square with a pulsing amber dot.
 * Единый компонент для boot loader, TopBar, TopNav, Footer.
 */
export const WavecodeLogo = (p: { size?: number; class?: string }): JSX.Element => (
  <svg
    width={p.size ?? 28}
    height={p.size ?? 28}
    viewBox="0 0 48 48"
    fill="none"
    aria-hidden="true"
    class={p.class ?? 'l-logo'}
  >
    <defs>
      <linearGradient id="l-logo-bg" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
        <stop offset="0"   stop-color="#ffaa3b" />
        <stop offset="0.5" stop-color="#5eead4" />
        <stop offset="1"   stop-color="#f472b6" />
      </linearGradient>
    </defs>
    <rect width="48" height="48" rx="10" fill="#11121a" />
    <rect x="2" y="2" width="44" height="44" rx="9" fill="none" stroke="#27272a" />
    <path
      d="M6 24 L10 24 L13 16 L16 32 L19 18 L22 30 L24 24 L28 24 M30 24 L33 22 M30 24 L33 26 M35 19 V29 M39 22 V26"
      stroke="url(#l-logo-bg)"
      stroke-width="2.2"
      stroke-linecap="round"
      stroke-linejoin="round"
      fill="none"
    />
    <circle cx="38" cy="13" r="1.6" fill="#ffaa3b">
      <animate attributeName="opacity" values="1;0.45;1" dur="1.6s" repeatCount="indefinite" />
    </circle>
  </svg>
);

// Legacy alias — старые импорты BrandLogo теперь получают WavecodeLogo.
export const BrandLogo = WavecodeLogo;
;
