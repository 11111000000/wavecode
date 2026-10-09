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
  'stroke-linecap': 'square' as const,
  'stroke-linejoin': 'miter' as const,
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

export const SpeakerIcon = (p: Props): JSX.Element => (
  <svg {...base(p.size ?? 14)} class={`wc-icon ${p.class ?? ''}`}>
    <path d="M2 6 L5 6 L8 3 L8 13 L5 10 L2 10 Z" />
    <path d="M10 5 Q13 8 10 11" />
  </svg>
);
