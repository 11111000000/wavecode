import { Show, type JSX } from 'solid-js';
import { Cause, Effect, Exit } from 'effect';
import {
  voiceAIState,
  voiceAIError,
  voiceAISupported,
  voiceAIElapsedSec,
  voiceAIFlushing,
  voiceAIRmsLevel,
  voiceAIDraft,
  setVoiceAIDraftText,
  cancelVoiceAIReview,
  cancelVoiceAISend,
  sendVoiceAIReview,
  discardVoiceAITake,
  dismissVoiceAI,
  startVoiceAI,
  stopVoiceAI,
} from '../state/voiceAIStore';
import { CloseIcon, MicIcon, SendIcon, TrashIcon } from '../icons';
import { consoleStore } from './consoleStore';
import { primeMicAudioContext } from '~/infrastructure/audio/micAudioContext';
import type { MicBusyError } from '~/domain/audio/MicChannel';
import type { SttUnsupportedError } from '~/application/voice/STTEngine';

/**
 * SpeechInput — вкладка «Речь» листа ввода.
 *
 * Что здесь и почему
 * -------------------
 * До переработки запись начинал плавающий круглый FAB: одно нажатие —
 * начало, второе — стоп. Теперь FAB открывает лист ввода, а кнопка
 * записи живёт ВНУТРИ вкладки «Речь» — рядом со статусом, который
 * описывает, что именно происходит с микрофоном.
 *
 * Это и есть ответ на вопрос «я сейчас голос записываю или ритм?»:
 * подпись вкладки, глагол в статусной строке и кнопка записи стоят
 * рядом, поэтому расхождение между ними физически невозможно.
 *
 *   ┌──────────────────────────────────────────────┐
 *   │ (●) Записываю… 7 с              ▓▓▓▓░░░░  🗑 │
 *   ├──────────────────────────────────────────────┤
 *   │ распознанный текст…                          │
 *   │                                              │
 *   │                                  [ → В ИИ ]  │
 *   └──────────────────────────────────────────────┘
 *
 * Контракт «сначала подтверди, потом отправляй» сохранён: текст уходит
 * в LLM только по кнопке «→ В ИИ» (см.
 * `decisions/wavecode-voice-confirm-before-send`).
 */

type Props = {
  readonly lang?: 'ru-RU' | string;
};

/**
 * Три состояния, в которых может быть запись. Считаются из FSM
 * оркестратора — он единственный источник правды, компонент только
 * отражает его.
 *
 *   off       — ничего не пишется. Нажатие начинает запись.
 *   recording — микрофон открыт (или открывается). Нажатие останавливает.
 *   busy      — запись остановлена, движок грузит аудио; транскрипт ещё
 *               в пути. Нажатие начинает СЛЕДУЮЩУЮ запись — оркестратор
 *               сам дождётся дренажа, поэтому нажатие не пропадает.
 *   blocked   — браузер не может писать (нет движка распознавания или
 *               нет разрешения). Кнопка отключена.
 */
type Phase = 'off' | 'recording' | 'busy' | 'blocked';

/** Перевести типизированную причину сбоя в сообщение для человека. */
const formatError = (
  err: MicBusyError | SttUnsupportedError,
): string => {
  if (err._tag === 'MicBusy') {
    return 'Микрофон занят другим режимом';
  }
  switch (err.reason) {
    case 'no-speech-api':
      return 'Открой в Chrome для голосового управления';
    case 'permission-denied':
      return 'Браузер заблокировал доступ к микрофону';
    case 'network':
      return 'Не получилось связаться с голосовым сервисом';
    case 'aborted':
      return 'Голосовой ввод прерван';
    default:
      return 'Не удалось запустить голосовой ввод';
  }
};

/**
 * Сработало ли последнее сбое как «браузер не даёт микрофон».
 *
 * Читается ВИД сбоя, а не его текст: прежняя версия искала в тексте
 * `/permission|NotAllowed/`, но все сообщения в приложении русские, и
 * регулярка никогда не срабатывала. Причина сбоя обязана путешествовать
 * данными, а не прозой.
 */
const isPermissionBlocked = (): boolean =>
  voiceAIError()?.kind === 'permission';

/**
 * Запустить Effect, который может упасть, и показать сбой тостом.
 *
 * `runPromiseExit` + `Cause.squash` вместо `runPromise`: второе
 * отклоняется с обёрткой `FiberFailure`, у которой `_tag` — ни
 * 'MicBusy', ни 'SttUnsupported', типизированная ошибка не доходила до
 * форматтера, и пользователь видел сырой JSON объекта ошибки.
 */
const runEffectSafely = async (
  eff: Effect.Effect<void, MicBusyError | SttUnsupportedError, never>,
): Promise<void> => {
  const exit = await Effect.runPromiseExit(eff);
  if (Exit.isSuccess(exit)) return;
  const err = Cause.squash(exit.cause);
  const msg = (() => {
    if (typeof err === 'object' && err !== null) {
      const tag = (err as { readonly _tag?: unknown })._tag;
      if (tag === 'MicBusy' || tag === 'SttUnsupported') {
        return formatError(err as MicBusyError | SttUnsupportedError);
      }
    }
    return err instanceof Error ? err.message : String(err);
  })();
  consoleStore.pushToast({
    severity: 'warn',
    title: 'Голос',
    body: msg,
  });
};

export function SpeechInput(props: Props): JSX.Element {
  const phase = (): Phase => {
    if (!voiceAISupported()) return 'blocked';
    // Окно дренажа идёт первым: FSM ещё в `listening`, пока движок
    // выгружает запись, но микрофон уже закрыт.
    if (voiceAIFlushing()) return 'busy';
    const tag = voiceAIState().tag;
    if (tag === 'arming' || tag === 'listening') return 'recording';
    return 'off';
  };

  const isRecording = (): boolean => phase() === 'recording';

  const onToggle = (): void => {
    const p = phase();
    if (p === 'blocked') return;
    if (p === 'recording') {
      // Второе нажатие: остановить запись. `stopVoiceAI` не отменяет,
      // а выгружает — аудио уходит в распознаватель, транскрипт
      // приходит через ~16 с. Эффект «fire-and-forget»: блокировать
      // обработчик на сетевом запросе нельзя, статусная строка всё это
      // время показывает «Распознаю…».
      void runEffectSafely(Effect.suspend(() => stopVoiceAI()));
      return;
    }
    // Первое нажатие (или нажатие в окне дренажа): начать запись.
    // `continuous` держит сессию живой между фразами, чтобы следующая
    // запись продолжила ту же (редуктор сохраняет транскрипт).
    //
    // Уровнемеру нужен AudioContext, и на iOS он работает, только если
    // контекст создан И запущен внутри этого клика — созданный после
    // запроса микрофона остаётся suspended, и уровень всегда нулевой.
    // См. `micAudioContext.ts`.
    primeMicAudioContext();
    void runEffectSafely(
      startVoiceAI({ mode: 'continuous', lang: props.lang ?? 'ru-RU' }),
    );
  };

  /**
   * «Удалить» — удалить аудио, оставить текст.
   *
   * Кнопка есть только пока запись ещё идёт: когда запись остановлена,
   * аудио уже в пути к распознавателю, и кнопка, обещающая его вернуть,
   * была бы враньём. Окно дренажа исключено по той же причине.
   */
  const canDiscard = (): boolean => {
    const tag = voiceAIState().tag;
    if (tag === 'arming') return true;
    return tag === 'listening' && !voiceAIFlushing();
  };

  const onDiscard = async (): Promise<void> => {
    try {
      await Effect.runPromise(discardVoiceAITake());
    } catch {
      /* оркестратор сам покажет ошибку */
    }
  };

  /** Запрос ушёл в сеть? */
  const sendInFlight = (): boolean => {
    const tag = voiceAIState().tag;
    return tag === 'requesting' || tag === 'applying';
  };

  /** Ждёт ли пользователь ответа машины? */
  const isBusy = (): boolean =>
    sendInFlight()
    || voiceAIState().tag === 'transcribing'
    || (voiceAIState().tag === 'listening' && voiceAIFlushing());

  const isEmpty = (): boolean => voiceAIDraft().trim().length === 0;

  /**
   * Можно ли отправить композер прямо сейчас.
   *
   * Можно больше, чем раньше: кнопка была включена, когда в поле было
   * что-то, и тихо ничего не делала вне `review`/`sent` — нажатие
   * пропадало. Теперь нажатие уважается везде, где оно вообще имеет
   * смысл: из живой записи оно останавливает её и отправляет транскрипт,
   * как только тот придёт.
   */
  const canSend = (): boolean => {
    const tag = voiceAIState().tag;
    if (tag === 'errored' || tag === 'idle') return false;
    if (sendInFlight()) return false;
    return true;
  };

  const onSend = async (): Promise<void> => {
    if (isEmpty()) return;
    try {
      await Effect.runPromise(sendVoiceAIReview(voiceAIDraft()));
    } catch {
      /* оркестратор сам покажет ошибку */
    }
  };

  const onCancelSend = async (): Promise<void> => {
    try {
      await Effect.runPromise(cancelVoiceAISend());
      consoleStore.pushToast({
        severity: 'info',
        title: 'Голос',
        body: 'Отправка отменена — текст остался в поле',
      });
    } catch {
      /* ditto */
    }
  };

  /**
   * Что делает машина — человеческим языком.
   *
   * Эта строка — весь ответ на «ушло не ушло, крутится или нет». У
   * каждого состояния сессии ровно одна фраза, и ни одна не врёт:
   * панель никогда не говорит «записываю», когда микрофон закрыт, и
   * никогда не молчит.
   */
  const statusText = (): string => {
    const tag = voiceAIState().tag;
    switch (tag) {
      case 'arming':
        return 'Готовлю микрофон…';
      case 'listening':
        // Палец отпущен, запись выгружается: микрофон уже закрыт, и
        // «записываю… N с» было бы враньём, которое ещё и выглядит
        // как зависание на ~16 с сетевого запроса.
        return voiceAIFlushing()
          ? 'Распознаю…'
          : `Записываю… ${voiceAIElapsedSec()} с`;
      case 'transcribing':
        return 'Распознаю…';
      case 'requesting':
        return 'Отправляю в ИИ…';
      case 'applying':
        return 'Применяю правку…';
      case 'review':
        return 'Текст готов — правьте и отправляйте';
      case 'sent':
        return '✓ Правка применена — можно отправить заново';
      case 'paused':
        return 'Запись на паузе — нажмите кнопку записи, чтобы продолжить';
      case 'idle':
        return 'Готов к записи — нажмите кнопку записи';
      case 'errored': {
        const s = voiceAIState();
        return s.tag === 'errored' ? s.error : 'Ошибка голосового ввода';
      }
      default:
        return '…';
    }
  };

  const meterWidthPct = (): number => {
    const lvl = voiceAIRmsLevel();
    if (lvl === null) return 0;
    // Та же калибровка `* 400`, что и у свиста (`__rms-fill`).
    // Порог речи (SPEECH_RMS_THRESHOLD = 0.02) переключается на
    // ширине 8%, спокойный голос с 30 см даёт 0.05–0.10 → 20–40%, а
    // громкая речь на мгновение доходит до 80–100%. Пользователь,
    // увидевший, что полоса перевалила за 20%, уверен: распознаватель
    // слышит речь.
    return Math.min(100, Math.round(lvl * 400));
  };

  const recLabel = (): string => {
    if (phase() === 'blocked') return 'Микрофон недоступен';
    return isRecording() ? 'Стоп' : 'Записать';
  };

  const recTitle = (): string => {
    if (!voiceAISupported()) {
      return 'Открой в Chrome для голосового управления';
    }
    const err = voiceAIError();
    if (err !== null) return err.message;
    return isRecording()
      ? 'Остановить запись'
      : 'Записать речь — текст появится здесь';
  };

  return (
    <div class="speech-input" data-state={voiceAIState().tag}>
      <div class="speech-input__head">
        <button
          type="button"
          class="speech-input__rec"
          data-rec-state={isRecording() ? 'on' : 'off'}
          data-permission-blocked={isPermissionBlocked() ? 'true' : 'false'}
          disabled={!voiceAISupported()}
          aria-pressed={isRecording() ? 'true' : 'false'}
          aria-label={recLabel()}
          title={recTitle()}
          onClick={onToggle}
        >
          <Show
            when={isRecording()}
            fallback={<MicIcon size={16} />}
          >
            {/* Пока идёт запись, кнопка IS кнопка записи: микрофон
             * сменяется мигающей точкой, состояние читается сразу. */}
            <span class="speech-input__rec-dot" aria-hidden="true" />
          </Show>
          <span class="speech-input__rec-label">{recLabel()}</span>
          <Show when={isPermissionBlocked()}>
            <span
              class="speech-input__rec-badge"
              aria-hidden="true"
              title="Браузер блокирует микрофон"
            >
              !
            </span>
          </Show>
        </button>

        <div class="speech-input__status">
          <Show when={isBusy()}>
            <span class="speech-input__spinner" aria-hidden="true" />
          </Show>
          <span class="speech-input__status-text">{statusText()}</span>
          <Show when={voiceAIRmsLevel() !== null}>
            <span
              class="speech-input__rms"
              aria-label="Громкость голоса"
              aria-hidden="true"
            >
              <span
                class="speech-input__rms-fill"
                style={{ width: `${meterWidthPct()}%` }}
              />
            </span>
          </Show>
        </div>

        <Show when={canDiscard()}>
          <button
            type="button"
            class="speech-input__delete"
            aria-label="Удалить запись"
            title="Удалить запись (текст останется)"
            onClick={() => { void onDiscard(); }}
          >
            <TrashIcon size={13} />
          </button>
        </Show>
      </div>

      <div class="speech-input__composer">
        <textarea
          class="speech-input__review-textarea"
          rows={2}
          value={voiceAIDraft()}
          aria-label="Распознанный текст — его можно править перед отправкой"
          placeholder="Говорите — текст появится здесь"
          onInput={(e) => { setVoiceAIDraftText(e.currentTarget.value); }}
          onKeyDown={(e) => {
            // Cmd/Ctrl+Enter — клавиатурный эквивалент «→ В ИИ».
            // Обычный Enter вставляет перевод строки (поведение
            // textarea); отправка без мыши — только с модификатором.
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              void onSend();
            }
          }}
        />
      </div>

      <div class="speech-input__actions">
        <Show
          when={sendInFlight()}
          fallback={
            <Show when={canSend()}>
              <button
                type="button"
                class="speech-input__btn speech-input__btn--primary"
                aria-label="Отправить текст в ИИ"
                title="Отправить в ИИ (Cmd/Ctrl+Enter)"
                disabled={isEmpty()}
                onClick={() => { void onSend(); }}
              >
                <SendIcon size={12} />
                <span>→ В ИИ</span>
              </button>
            </Show>
          }
        >
          <button
            type="button"
            class="speech-input__btn speech-input__btn--cancel"
            aria-label="Отменить отправку в ИИ"
            title="Отменить отправку — текст останется в поле"
            onClick={() => { void onCancelSend(); }}
          >
            <CloseIcon size={12} />
            <span>Отменить отправку</span>
          </button>
        </Show>
      </div>
    </div>
  );
}

/**
 * Отмена голосовой сессии при закрытии листа ввода.
 *
 * Готовый текст сохраняется (черновик переживает закрытие — его можно
 * дописать и отправить позже), незавершённая запись отбрасывается.
 * Экспортируется наружу, потому что закрыть лист можно четырьмя
 * разными путями (крестик, свайп, backdrop, Esc), и ловить их всех
 * по одному — способ надёжно что-то забыть.
 */
export const cancelSpeechOnSheetClose = async (): Promise<void> => {
  try {
    if (voiceAIState().tag === 'review') {
      await Effect.runPromise(cancelVoiceAIReview());
    } else if (voiceAIState().tag !== 'idle') {
      await Effect.runPromise(dismissVoiceAI());
    }
  } catch {
    /* оркестратор сам разберётся с ошибкой */
  }
};
