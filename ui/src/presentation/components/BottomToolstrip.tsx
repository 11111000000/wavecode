import { For, type JSX } from 'solid-js';
import {
  openKindSheet, closeKindSheet, getKindSnap,
} from '~/presentation/state/uiState';
import { StepIcon, PianoIcon, TabMixerIcon } from '~/presentation/icons';

export type BottomToolstripProps = {
  /** Called before opening step sheet. Use to auto-populate grid from score. */
  onBeforeOpenStep?: () => void;
};

type ToolKind = 'step' | 'piano' | 'mixer';

type Tool = {
  readonly kind: ToolKind;
  readonly label: string;
  readonly icon: (p: { size?: number }) => JSX.Element;
  readonly prepare: (() => void) | undefined;
};

const TOOLS: ReadonlyArray<Tool> = [
  { kind: 'step', label: 'Step', icon: StepIcon, prepare: undefined },
  { kind: 'piano', label: 'Piano', icon: PianoIcon, prepare: undefined },
  { kind: 'mixer', label: 'Mixer', icon: TabMixerIcon, prepare: undefined },
];

/**
 * BottomToolstrip — horizontal toolbar над TabBar с тогглами
 * Step / Piano / Mixer. Каждая иконка — single-tap toggle
 * соответствующего bottom-sheet через `openKindSheet` /
 * `closeKindSheet`. Подсвечивается когда sheet открыт.
 *
 * 1-tap UX: чипсы в PresetRow требовали взгляда на верх; здесь
 * всё «инструментальное» живёт рядом с AI/Status (TabBar).
 */
export function BottomToolstrip(props: BottomToolstripProps): JSX.Element {
  const tools: ReadonlyArray<Tool> = TOOLS.map((t) =>
    t.kind === 'step'
      ? { ...t, prepare: props.onBeforeOpenStep }
      : t,
  );

  return (
    <div class="wc-toolstrip" role="toolbar" aria-label="Инструменты">
      <For each={tools}>
        {(tool) => {
          const isOpen = (): boolean => getKindSnap(tool.kind) !== 'closed';
          return (
            <button
              type="button"
              class="wc-toolstrip-btn"
              data-active={isOpen() ? 'true' : 'false'}
              aria-pressed={isOpen()}
              onClick={() => {
                if (isOpen()) {
                  closeKindSheet(tool.kind);
                  return;
                }
                tool.prepare?.();
                openKindSheet(tool.kind, 'full');
              }}
              title={`${tool.label} (${isOpen() ? 'закрыть' : 'открыть'})`}
              aria-label={tool.label}
            >
              <tool.icon size={16} />
              <span class="wc-toolstrip-btn__label">{tool.label}</span>
            </button>
          );
        }}
      </For>
    </div>
  );
}