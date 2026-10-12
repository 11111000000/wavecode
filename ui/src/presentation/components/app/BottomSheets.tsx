import type { JSX } from 'solid-js';
import { BottomSheet } from '~/presentation/components/BottomSheet';
import { MixerPanel } from '~/presentation/components/MixerPanel';
import { StepGrid } from '~/presentation/components/StepGrid';
import { PianoKeyboard } from '~/presentation/components/PianoKeyboard';
import { HelloPanel } from '~/presentation/panels/HelloPanel';
import { AIEditPanel } from '~/presentation/panels/AIEditPanel';

export type BottomSheetsProps = Record<string, never>;

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

      <BottomSheet kind="piano" title="Piano" subtitle="WebMIDI auto-bind">
        <div class="piano-sheet-body">
          <PianoKeyboard />
        </div>
      </BottomSheet>
    </>
  );
}
