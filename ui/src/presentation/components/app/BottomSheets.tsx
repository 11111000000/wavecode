import { Show, type JSX } from 'solid-js';
import { BottomSheet } from '~/presentation/components/BottomSheet';
import { MixerPanel } from '~/presentation/components/MixerPanel';
import { StepGrid } from '~/presentation/components/StepGrid';
import { PianoKeyboard } from '~/presentation/components/PianoKeyboard';
import { HelloPanel } from '~/presentation/panels/HelloPanel';
import { AIEditPanel } from '~/presentation/panels/AIEditPanel';
import { VisualizerPanel } from '~/presentation/panels/VisualizerPanel';

export type BottomSheetsProps = Record<string, never>;

/**
 * Piano split (wavecode-piano-rec-clarity):
 *   - Desktop (≥1024px) → no piano BottomSheet here. The piano is
 *     rendered inline in ScorePanel under a collapsible header
 *     (`▼ Piano`). Showing a BottomSheet-piano on desktop would
 *     duplicate the component AND cover the editor that the inline
 *     piano is meant to coexist with.
 *   - Mobile (<1024px) → BottomSheet-piano at the bottom, full-height
 *     snap. ScorePanel hides its inline piano on the same breakpoint.
 *   - The TabBar "Piano" tab still exists on both viewports — on
 *     desktop, tapping it is a no-op (no BottomSheet renders).
 *     That's a small UX wart tracked for a follow-up packet.
 *
 * The viewport match is evaluated at render-time. If the user
 * resizes across the breakpoint, BottomSheets re-renders via Solid's
 * reactive scope and the sheet opens/closes accordingly.
 */
const isDesktopViewport = (): boolean => {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(min-width: 1024px)').matches;
};

export function BottomSheets(_: BottomSheetsProps): JSX.Element {
  void _;
  return (
    <>
      <BottomSheet kind="status" title="Состояние" subtitle="run-time telemetry">
        <HelloPanel />
      </BottomSheet>

      <BottomSheet kind="ai" title="ИИ-ассистент" subtitle="live-coding chat">
        <AIEditPanel />
      </BottomSheet>

      <BottomSheet kind="mixer" title="Микшер" subtitle="M/S · gain">
        <MixerPanel />
      </BottomSheet>

      <BottomSheet kind="step" title="Step grid" subtitle="4×8 pads">
        <div class="step-sheet-body">
          <StepGrid />
        </div>
      </BottomSheet>

      {/* wavecode-visualizer-tab: full-snap by default (see uiState.setTab)
          so the spectrum canvas doesn't get squashed to 50px on small
          phones. BottomSheet still respects the same drag-to-resize
          affordances as the other sheets. */}
      <BottomSheet
        kind="visualize"
        title="Визуализация"
        subtitle="карта цикла + эквалайзер"
      >
        <VisualizerPanel />
      </BottomSheet>

      <Show when={!isDesktopViewport()}>
        <BottomSheet kind="piano" title="Piano" subtitle="WebMIDI auto-bind">
          <div class="piano-sheet-body">
            <PianoKeyboard variant="sheet" />
          </div>
        </BottomSheet>
      </Show>
    </>
  );
}