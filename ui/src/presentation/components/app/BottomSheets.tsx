import { Show, Suspense, type JSX } from 'solid-js';
import { BottomSheet } from '~/presentation/components/BottomSheet';
import { MixerPanel } from '~/presentation/components/MixerPanel';
import { StepGrid } from '~/presentation/components/StepGrid';
import { PianoKeyboard } from '~/presentation/components/PianoKeyboard';
import { HelloPanel } from '~/presentation/panels/HelloPanel';
import { AIEditPanel } from '~/presentation/panels/AIEditPanel';
import { VisualizerPanelLazy } from '~/presentation/panels/VisualizerPanelLazy';
import { GesturePanelLazy } from '~/presentation/panels/GesturePanelLazy';
import { ToolsSheet } from './ToolsSheet';
import { ExportSheet } from './ExportSheet';
import { InputSheet } from './InputSheet';

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
      <BottomSheet kind="status" title="Состояние" subtitle="телеметрия рантайма">
        <HelloPanel />
      </BottomSheet>

      <BottomSheet kind="ai" title="ИИ-ассистент" subtitle="чат live-coding">
        <AIEditPanel />
      </BottomSheet>

      <BottomSheet kind="mixer" title="Микшер" subtitle="громкость, mute и solo">
        <MixerPanel />
      </BottomSheet>

      <BottomSheet kind="step" title="Шаги" subtitle="сетка 4×8">
        <div class="step-sheet-body">
          <StepGrid />
        </div>
      </BottomSheet>

      {/* wavecode-visualizer-tab: full-snap by default (see uiState.setTab)
          so the spectrum canvas doesn't get squashed to 50px on small
          phones. BottomSheet still respects the same drag-to-resize
          affordances as the other sheets.

          VisualizerPanel is loaded via `VisualizerPanelLazy`
          (wavecode-bundle-split). The chunk (~14 KB raw, ~5 KB gz)
          only fetches when the user first opens the
          «Визуализация» tab — keeps the cold-start main chunk slim.
          Solid's `<Suspense>` boundary catches the dynamic import
          pending state without disturbing the sheet's drag/snap UX. */}
      <BottomSheet
        kind="visualize"
        title="Визуализация"
        subtitle="карта цикла + эквалайзер"
      >
        <Suspense fallback={<div class="visualizer-panel visualizer-panel--loading" />}>
          <VisualizerPanelLazy />
        </Suspense>
      </BottomSheet>

      <Show when={!isDesktopViewport()}>
        <BottomSheet kind="piano" title="Пианино" subtitle="авто-подключение WebMIDI">
          <div class="piano-sheet-body">
            <PianoKeyboard variant="sheet" />
          </div>
        </BottomSheet>
      </Show>

      {/* wavecode-unified-input-entry: ввод — один лист с тремя
          вкладками (Речь | Свист | Ритм). Отдельного листа «Микрофон»
          больше нет: свист живёт вкладкой, а круглая кнопка «Ввод» —
          единственная точка входа во все три. */}
      <InputSheet />

      {/* wavecode-hand-gesture-control: «управление руками». The panel is
          loaded lazily (the camera tracker must stay out of the cold-start
          bundle) and the camera itself only starts when the user flips the
          «Управление руками» toggle INSIDE the panel — opening the sheet
          never asks for a permission. */}
      <BottomSheet
        kind="gesture"
        title="Руки"
        subtitle="жесты → музыка"
      >
        <Suspense fallback={<div class="gesture-panel gesture-panel--loading" />}>
          <GesturePanelLazy />
        </Suspense>
      </BottomSheet>

      {/* wavecode-zen-minimal-ui (ревизия 2): всё, что не вошло в рельс
          из четырёх пунктов, живёт здесь — одним листом с поиском. */}
      <ToolsSheet />

      {/* MIDI-импорт/экспорт и WAV-рендер были реализованы, но не
          смонтированы. Теперь они доступны из одного места. */}
      <ExportSheet />
    </>
  );
}