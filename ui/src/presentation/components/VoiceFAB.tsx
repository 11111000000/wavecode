import { type JSX } from 'solid-js';
import { VoiceAIMiniFAB } from './VoiceAIMiniFAB';
import { WhistleMiniFAB } from './WhistleMiniFAB';
import { VoiceTranscriptOverlay } from './VoiceTranscriptOverlay';
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
 *   - VoiceTranscriptOverlay (всплывает над кнопкой: 🎙️ + текст +
 *     кнопка «Открыть для проверки», если сессия активна),
 *   - VoiceAITextReview (модал-проверка текста перед отправкой в ИИ;
 *     появляется только когда FSM в `review`),
 *   - inline-hint «слушаю…» / расшифровка прямо в кнопке.
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
      <VoiceTranscriptOverlay />
      <VoiceAITextReview />
    </>
  );
}
