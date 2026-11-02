import { type JSX } from 'solid-js';
import { VoiceAIMiniFAB } from './VoiceAIMiniFAB';
import { WhistleMiniFAB } from './WhistleMiniFAB';
import { RhythmMiniFAB } from './RhythmMiniFAB';
import { RecordingPanel } from './RecordingPanel';

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
 * Сейчас: все мини-FAB всегда на экране, у каждого свой
 * aria-label и подпись-чип рядом.
 *   - VoiceAIMiniFAB  → «Голос»: тап = старт/стоп распознавания,
 *                       удержание = одна фраза.
 *   - WhistleMiniFAB  → «Свист»: тап = старт/стоп записи свиста →
 *                       нота → вставка в score.
 *   - RhythmMiniFAB   → «Ритм»: тап = старт/стоп записи ударов →
 *                       сетка → вставка в score.
 *
 * Свист и Ритм — две половины одного микрофона: свист пишет
 * МЕЛОДИЮ (ноты), ритм — ПЕРКУССИЮ (удары на сетке). Смешивать их
 * было нельзя: детектор ударов срабатывает и на атаке самого свиста,
 * и каждая фраза прорастала лишним хлопком.
 *
 * Состояние записи транслируется через
 *   - data-state на самой кнопке (glow + pulse animation),
 *   - RecordingPanel (панель внизу: 🎙️ + transcript + заметки;
 *     единая для voice-AI, whistle и rhythm — раньше для whistle
 *     панели не было вовсе).
 *   - inline-hint «слушаю…» / расшифровка прямо в кнопке.
 *
 * VoiceTranscriptOverlay (старый чип-оверлей) удалён — RecordingPanel
 * его заменяет для voice-AI и расширяет функциональность для whistle.
 * VoiceAITextReview (модал-проверка текста перед отправкой в ИИ)
 * удалён в `decisions/wavecode-voice-live-transcript`: live interim
 * chunks (`interim` kind) делают панель самодостаточной, отдельный
 * review-шаг больше не нужен. FSM-тег `review` всё ещё существует в
 * редукторе для будущих расширений, но UI-аффорданса нет.
 */
export function VoiceFAB(): JSX.Element {
  return (
    <>
      <div class="voice-fab-group">
        <div class="voice-mini-fab-stack">
          <VoiceAIMiniFAB />
          <WhistleMiniFAB />
          <RhythmMiniFAB />
        </div>
      </div>
      <RecordingPanel />
    </>
  );
}
