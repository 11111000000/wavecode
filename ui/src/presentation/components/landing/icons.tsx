import type { JSX } from 'solid-js';

type IconProps = { size?: number; class?: string };

const base = (
  size: number,
): JSX.SvgSVGAttributes<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': 1.6,
  'stroke-linecap': 'round' as const,
  'stroke-linejoin': 'round' as const,
  'aria-hidden': 'true',
});

/* ─── FEATURE ICONS ─────────────────────────────────────── */

export const AgentIcon = (p: IconProps): JSX.Element => (
  <svg {...base(p.size ?? 22)} class={p.class}>
    <rect x="3" y="6" width="18" height="13" rx="3" />
    <path d="M12 6 V3 M9 3 H15" />
    <circle cx="9" cy="13" r="1.2" fill="currentColor" />
    <circle cx="15" cy="13" r="1.2" fill="currentColor" />
    <path d="M9 16 H15" />
  </svg>
);

export const PatternIcon = (p: IconProps): JSX.Element => (
  <svg {...base(p.size ?? 22)} class={p.class}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="4" />
    <path d="M3 12 H21 M12 3 V21" />
  </svg>
);

export const AudioIcon = (p: IconProps): JSX.Element => (
  <svg {...base(p.size ?? 22)} class={p.class}>
    <path d="M3 12 L3 18 M6 9 L6 21 M9 4 L9 16 M12 14 L12 24 M15 6 L15 18 M18 10 L18 22 M21 14 L21 22" />
  </svg>
);

export const EditorIcon = (p: IconProps): JSX.Element => (
  <svg {...base(p.size ?? 22)} class={p.class}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M3 9 H21" />
    <path d="M7 13 L9 15 L13 11" />
    <path d="M14 17 H17" />
  </svg>
);

export const StorageIcon = (p: IconProps): JSX.Element => (
  <svg {...base(p.size ?? 22)} class={p.class}>
    <ellipse cx="12" cy="5" rx="8" ry="2.5" />
    <path d="M4 5 V12 C4 13.5 7.5 14.5 12 14.5 C16.5 14.5 20 13.5 20 12 V5" />
    <path d="M4 12 V19 C4 20.5 7.5 21.5 12 21.5 C16.5 21.5 20 20.5 20 19 V12" />
  </svg>
);

export const ShareIcon24 = (p: IconProps): JSX.Element => (
  <svg {...base(p.size ?? 22)} class={p.class}>
    <circle cx="6" cy="12" r="2.5" />
    <circle cx="18" cy="6" r="2.5" />
    <circle cx="18" cy="18" r="2.5" />
    <path d="M8 11 L16 7 M8 13 L16 17" />
  </svg>
);

/* ─── PANEL ICONS ───────────────────────────────────────── */

export const TransportIcon = (p: IconProps): JSX.Element => (
  <svg {...base(p.size ?? 22)} class={p.class}>
    <path d="M5 4 L19 12 L5 20 Z" fill="currentColor" stroke="none" />
  </svg>
);

export const MixerIcon = (p: IconProps): JSX.Element => (
  <svg {...base(p.size ?? 22)} class={p.class}>
    <line x1="6"  y1="3" x2="6"  y2="21" />
    <line x1="12" y1="3" x2="12" y2="21" />
    <line x1="18" y1="3" x2="18" y2="21" />
    <rect x="4"   y="11" width="4" height="3" fill="currentColor" stroke="none" />
    <rect x="10"  y="7"  width="4" height="3" fill="currentColor" stroke="none" />
    <rect x="16"  y="14" width="4" height="3" fill="currentColor" stroke="none" />
  </svg>
);

export const PianoIcon24 = (p: IconProps): JSX.Element => (
  <svg {...base(p.size ?? 22)} class={p.class}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <line x1="3"  y1="5" x2="3"  y2="13" />
    <line x1="9"  y1="5" x2="9"  y2="13" />
    <line x1="15" y1="5" x2="15" y2="13" />
    <line x1="21" y1="5" x2="21" y2="13" />
    <rect x="5"  y="13" width="2.4" height="6" fill="currentColor" stroke="none" />
    <rect x="11" y="13" width="2.4" height="6" fill="currentColor" stroke="none" />
    <rect x="17" y="13" width="2.4" height="6" fill="currentColor" stroke="none" />
  </svg>
);

export const StepGridIcon = (p: IconProps): JSX.Element => (
  <svg {...base(p.size ?? 22)} class={p.class}>
    <rect x="3"  y="3"  width="6" height="6" rx="1" />
    <rect x="11" y="3"  width="6" height="6" rx="1" fill="currentColor" stroke="none" />
    <rect x="3"  y="11" width="6" height="6" rx="1" fill="currentColor" stroke="none" />
    <rect x="11" y="11" width="6" height="6" rx="1" />
  </svg>
);

export const RecordIcon24 = (p: IconProps): JSX.Element => (
  <svg {...base(p.size ?? 22)} class={p.class}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="5" fill="currentColor" stroke="none" />
  </svg>
);

export const MidiIcon = (p: IconProps): JSX.Element => (
  <svg {...base(p.size ?? 22)} class={p.class}>
    <circle cx="6"  cy="6"  r="2" />
    <circle cx="18" cy="6"  r="2" />
    <circle cx="6"  cy="18" r="2" />
    <circle cx="18" cy="18" r="2" />
    <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />
    <path d="M7.5 7.5 L10.5 10.5 M16.5 7.5 L13.5 10.5 M7.5 16.5 L10.5 13.5 M16.5 16.5 L13.5 13.5" />
  </svg>
);

export const SampleIcon = (p: IconProps): JSX.Element => (
  <svg {...base(p.size ?? 22)} class={p.class}>
    <path d="M3 12 H21" />
    <path d="M3 12 L7 8 M3 12 L7 16" />
    <path d="M9 7 V17 M12 5 V19 M15 8 V16 M18 6 V18" />
    <rect x="20" y="11" width="1.4" height="2" fill="currentColor" stroke="none" />
  </svg>
);

export const ConsoleIcon = (p: IconProps): JSX.Element => (
  <svg {...base(p.size ?? 22)} class={p.class}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M7 9 L10 12 L7 15" />
    <path d="M11 15 H17" />
  </svg>
);

/* ─── UI affordances ────────────────────────────────────── */

export const ArrowRight = (p: IconProps): JSX.Element => (
  <svg {...base(p.size ?? 16)} class={p.class}>
    <path d="M5 12 H19 M13 6 L19 12 L13 18" />
  </svg>
);

/* ─── PLAY / STOP affordances — for landing-page preset preview ─────── */

export const PlayIcon = (p: IconProps): JSX.Element => (
  <svg {...base(p.size ?? 14)} class={p.class}>
    <path d="M7 5 L19 12 L7 19 Z" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linejoin="round" />
  </svg>
);

export const StopIcon = (p: IconProps): JSX.Element => (
  <svg {...base(p.size ?? 14)} class={p.class}>
    <rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" stroke="currentColor" stroke-width="1" />
  </svg>
);

export const ChevronDown = (p: IconProps): JSX.Element => (
  <svg {...base(p.size ?? 16)} class={p.class}>
    <path d="M6 9 L12 15 L18 9" />
  </svg>
);

export const GitHubIcon = (p: IconProps): JSX.Element => (
  <svg width={p.size ?? 18} height={p.size ?? 18} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0022 12.017C22 6.484 17.522 2 12 2z" />
  </svg>
);

// WavecodeLogo — локальный логотип (re-export из presentation/icons
// был убран: BrandLogo в master отличается от WavecodeLogo в ветке
// feat/landing-page, и чтобы не менять существующий UI, держим
// локальную копию).
export const WavecodeLogo = (p: IconProps): JSX.Element => (
  <svg
    width={p.size ?? 24}
    height={p.size ?? 24}
    viewBox="0 0 120 32"
    fill="none"
    aria-hidden="true"
    class={p.class}
  >
    <defs>
      <linearGradient id="wclogo-grad" x1="0" y1="0" x2="120" y2="0" gradientUnits="userSpaceOnUse">
        <stop offset="0"   stop-color="#a78bfa" />
        <stop offset="0.5" stop-color="#5eead4" />
        <stop offset="1"   stop-color="#f472b6" />
      </linearGradient>
    </defs>
    <path
      d="M2 22 L8 22 L11 6 L14 26 L17 8 L20 22 L26 22"
      stroke="url(#wclogo-grad)"
      stroke-width="2.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      fill="none"
    />
    <circle cx="32" cy="16" r="2.6" fill="#a78bfa">
      <animate attributeName="opacity" values="1;0.5;1" dur="1.6s" repeatCount="indefinite" />
    </circle>
    <text
      x="40"
      y="22"
      font-family="Geist, system-ui, sans-serif"
      font-size="18"
      font-weight="600"
      letter-spacing="-0.02em"
      fill="currentColor"
    >
      wavecode
    </text>
  </svg>
);
