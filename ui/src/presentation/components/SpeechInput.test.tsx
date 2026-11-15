import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@solidjs/testing-library';
import { Effect, Stream } from 'effect';
import { SpeechInput } from './SpeechInput';
import {
  __resetVoiceAIForTests,
  __publishVoiceAIStateForTests,
  __setVoiceAIHandleForTests,
} from '../state/voiceAIStore';
import { resetMicMutexForTests } from '../state/micMutexStore';
import { initialTranscriptState } from '~/domain/voice/Transcript';

// Только prime подменяется — остальной модуль (реальная фабрика
// контекста) должен работать, чтобы уровнемер оставался живым.
vi.mock('~/infrastructure/audio/micAudioContext', async (importOriginal) => {
  const actual = await importOriginal<typeof MicAudioContextModule>();
  return { ...actual, primeMicAudioContext: vi.fn() };
});

import type * as MicAudioContextModule from '~/infrastructure/audio/micAudioContext';
import { primeMicAudioContext } from '~/infrastructure/audio/micAudioContext';

/**
 * SpeechInput — тело вкладки «Речь».
 *
 * wavecode-unified-input-entry: кнопка записи переехала сюда с
 * плавающей круглой кнопки. Кнопка и строка статуса теперь стоят рядом
 * и не могут разойтись — это и есть ответ на вопрос «я сейчас голос
 * записываю или ритм».
 */
beforeEach(() => {
  __resetVoiceAIForTests();
  resetMicMutexForTests();
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  __resetVoiceAIForTests();
  resetMicMutexForTests();
});

/** Подставной оркестратор: считает, что его попросили. */
const fakeHandle = (calls: { start: number; stop: number }) => ({
  start: () => Effect.sync(() => { calls.start += 1; }),
  stop: () => Effect.sync(() => { calls.stop += 1; }),
  closeCapture: () => Effect.void,
  onChunk: () => Effect.void,
  enterReview: () => Effect.void,
  sendReview: () => Effect.void,
  cancelReview: () => Effect.void,
  dismiss: () => Effect.void,
  cancelInFlight: () => Effect.void,
  stream: Stream.empty,
});

const listeningState = () => ({
  tag: 'listening' as const,
  transcript: initialTranscriptState('ru-RU'),
  continuous: false,
});

/** Дать «fire-and-forget» эффекту осесть. */
const settle = (): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, 30));

const recButton = (container: HTMLElement): HTMLButtonElement =>
  container.querySelector<HTMLButtonElement>('.speech-input__rec')!;

describe('SpeechInput — вкладка «Речь»', () => {
  it('рисует кнопку записи с честной подписью', () => {
    const { container } = render(() => <SpeechInput />);
    const btn = recButton(container);
    expect(btn.textContent).toContain('Записать');
    expect(btn.getAttribute('aria-label')).toBe('Записать');
  });

  it('нажатие начинает запись', async () => {
    const calls = { start: 0, stop: 0 };
    __setVoiceAIHandleForTests(fakeHandle(calls) as never);
    const { container } = render(() => <SpeechInput />);
    fireEvent.click(recButton(container));
    await settle();
    expect(calls.start).toBe(1);
    expect(calls.stop).toBe(0);
    expect(primeMicAudioContext).toHaveBeenCalled();
  });

  it('второе нажатие останавливает запись', async () => {
    const calls = { start: 0, stop: 0 };
    __setVoiceAIHandleForTests(fakeHandle(calls) as never);
    const { container } = render(() => <SpeechInput />);
    fireEvent.click(recButton(container));
    await settle();
    __publishVoiceAIStateForTests(listeningState());
    fireEvent.click(recButton(container));
    await settle();
    expect(calls.stop).toBe(1);
    expect(calls.start).toBe(1);
  });

  it('показывает «Стоп», пока идёт запись', () => {
    __publishVoiceAIStateForTests(listeningState());
    const { container } = render(() => <SpeechInput />);
    expect(recButton(container).textContent).toContain('Стоп');
    expect(recButton(container).getAttribute('data-rec-state')).toBe('on');
  });

  it('статусная строка говорит, что микрофон жив', () => {
    __publishVoiceAIStateForTests(listeningState());
    const { container } = render(() => <SpeechInput />);
    const status = container.querySelector('.speech-input__status-text')!;
    expect(status.textContent).toContain('Записываю');
  });

  it('в состоянии ожидания приглашает записать, а не говорит о микрофоне', () => {
    const { container } = render(() => <SpeechInput />);
    const status = container.querySelector('.speech-input__status-text')!;
    expect(status.textContent).toContain('Готов к записи');
  });

  it('композер всегда на месте — и в покое, и после записи', () => {
    __publishVoiceAIStateForTests(listeningState());
    const { container } = render(() => <SpeechInput />);
    const textarea = container.querySelector('textarea');
    expect(textarea).toBeTruthy();
    expect(textarea!.getAttribute('aria-label')).toContain('Распознанный текст');
  });
});
