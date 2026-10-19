import { type JSX } from 'solid-js';
import { VoiceAIMiniFAB } from './VoiceAIMiniFAB';
import { WhistleMiniFAB } from './WhistleMiniFAB';
import { RecordingPanel } from './RecordingPanel';
import { VoiceAITextReview } from './VoiceAITextReview';

/**
 * VoiceFAB — voice-input control cluster, всегда виден в правом
 * нижнем углу редактора. Без speed-dial.
 *
 * Раньше: одна большая primary-кнопка-«меню», по клику
 * разворачивалась стопка из VoiceAIMiniFAB + WhistleMiniFAB.
 * UX-жалоба: «жму микрофон — открывается ещё одна кнопка с
 * микрофоном, непонятно что вообще происходит». Двойная иконка
 * микрофона (primary + мини-AI) + отсутствие явной обратной связи
 * по записи сбивали с толку.
 *
 * Сейчас: оба мини-FAB всегда на экране, у каждого свой
 * aria-label и подпись-чип рядом.
 *   - VoiceAIMiniFAB  → «Голос»: тап = старт/стоп распознавания,
 *                       удержание = одна фраза.
 *   - WhistleMiniFAB  → «Свист»:  press-and-hold = запись свиста →
 *                       нота → вставка в score.
 *
 * Состояние записи транслируется через
 *   - data-state на самой кнопке (glow + pulse animation),
 *   - RecordingPanel (панель внизу: 🎙️ + transcript + заметки
 *     + кнопки; единая для voice-AI и whistle — раньше для whistle
 *     панели не было вовсе),
 *   - VoiceAITextReview (модал-проверка текста перед отправкой в ИИ;
 *     появляется только когда FSM в `review`),
 *   - inline-hint «слушаю…» / расшифровка прямо в кнопке.
 *
 * VoiceTranscriptOverlay (старый чип-оверлей) удалён — RecordingPanel
 * его заменяет для voice-AI и расширяет функциональность для whistle.
 */
export function VoiceFAB(): JSX.Element {
  return (
    <>
      <div class="voice-fab-group">
        <div class="voice-mini-fab-stack">
          <VoiceAIMiniFAB />
          <WhistleMiniFAB />
        </div>
      </div>
      <RecordingPanel />
      <VoiceAITextReview />
    </>
  );
}
