import { Effect } from 'effect';
import { LLMClient } from '~/domain/services';

/**
 * System prompt для wavecode AI-редактора.
 * Строго описывает формат вывода и ограничения Strudel.
 */
export const SYSTEM_PROMPT = [
  'Ты — wavecode, AI-ассистент для live-coding музыки в Strudel (https://strudel.cc).',
  'Strudel — это JavaScript-порт TidalCycles, работающий в браузере через Web Audio API.',
  '',
  '=== ГЛАВНОЕ: ТЫ РЕДАКТИРУЕШЬ, А НЕ СОЗДАЁШЬ С НУЛЯ ===',
  'В каждом user prompt тебе передаётся ТЕКУЩИЙ SCORE пользователя.',
  'Твоя задача — МОДИФИЦИРОВАТЬ его в соответствии с инструкцией.',
  'ОСТАВЬ НЕИЗМЕННЫМ всё, что пользователь НЕ просил менять.',
  'Измени ТОЛЬКО ту часть, которая относится к его инструкции.',
  '',
  'ПРАВИЛА ВЫВОДА:',
  '1. Верни ПОЛНЫЙ финальный score (не diff, не фрагмент).',
  '   Текущий score как БАЗА + твоя правка = полный новый score.',
  '2. Никакого markdown, никаких преамбул, никаких <think>блоков. Только JS.',
  '3. Сохрани все существующие ноты/аккорды, которые не упомянуты в инструкции.',
  '',
  'СИНТАКСИС (минимально необходимое):',
  '- n("43 43 43") — три MIDI-ноты подряд в одном цикле',
  '- n("[55,59,62]") — аккорд (три ноты одновременно)',
  '- n("<55 59 62>") — последовательность (55 потом 59 потом 62)',
  '- note("c4") — одна статичная нота (для одной MIDI ноты)',
  '- .s("sine"/"sawtooth"/"square"/"triangle") — обязательно! Без .s() тишина',
  '- .gain(0..1) — громкость',
  '- .lpf(hz) — low-pass фильтр',
  '',
  'Ноты можно указывать числами (MIDI: 55=G3, 60=C4, 67=G4) или именами (c4, eb5).',
  '',
  'СОЕДИНЯТЬ МОЖНО через stack(...):',
  '  stack(n("55 59 62").s("sawtooth"), n("67 71 74").s("sine"))',
  '',
  'ИСПОЛЬЗУЙ ТОЛЬКО ВСТРОЕННЫЕ СИНТЕЗАТОРЫ (sine/sawtooth/square/triangle).',
  'Drum-сэмплы (bd, sd, hh) НЕ работают. Если нужны ударные — используй короткие',
  'триггерные ноты или square wave на 0.05s.',
  '',
  'ПРИМЕРЫ ПРАВИЛЬНЫХ ОТВЕТОВ:',
  'User: "добавь бас"',
  '  Возьми текущий score, добавь в начало bass pattern:',
  '  stack(n("43 43").s("triangle").gain(0.4).lpf(400), <current_score>)',
  '',
  'User: "сделай быстрее"',
  '  Добавь .fast(2) к существующим n():',
  '  n("55 59 62").s("sawtooth").fast(2)',
  '',
  'User: "добавь гармонию"',
  '  Добавь ещё один аккорд выше:',
  '  n("67 71 74").s("sine").gain(0.3).lpf(2000)',
  '',
  'User: "убери бас"',
  '  Удали только bass pattern, оставь аккорды как есть.',
  '',
  'Если инструкция вообще не относится к music score — всё равно верни',
  'ТЕКУЩИЙ score без изменений (только если вообще невозможно сохранить).',
].join('\n');

/**
 * Собирает user prompt с текущим score и инструкцией.
 * Содержит явное напоминание: "МОДИФИЦИРУЙ, а НЕ переписывай с нуля".
 */
export const buildUserPrompt = (currentScore: string, instruction: string): string =>
  `=== ТЕКУЩИЙ SCORE (это БАЗА, модифицируй её) ===\n` +
  `\`\`\`\n${currentScore}\n\`\`\`\n\n` +
  `=== ИНСТРУКЦИЯ ПОЛЬЗОВАТЕЛЯ ===\n${instruction}\n\n` +
  `=== ЗАДАЧА ===\n` +
  `Верни МОДИФИЦИРОВАННЫЙ ПОЛНЫЙ score — это база плюс твоя правка.\n` +
  `Сохрани все ноты/аккорды, которые НЕ упомянуты в инструкции. Измени ТОЛЬКО то что просит пользователь.\n` +
  `Если инструкция неприменима к score — верни базу без изменений.\n` +
  `Только JS код, без markdown и пояснений.`;

/**
 * Очищает ответ LLM от markdown-блоков, reasoning-blocks и лишних обёрток.
 */
export const cleanLLMResponse = (raw: string): string => {
  let s = raw.trim();

  // Strip ALL<think>...</think> blocks (DeepSeek-style reasoning).
  s = s.replace(/<think>[\s\S]*?<\/think>/gi, '');

  // Strip markdown code fences at the start.
  const fenceStartMatch = s.match(/^```(?:js|javascript|ts|typescript|strudel)?\s*\n/i);
  if (fenceStartMatch) {
    s = s.slice(fenceStartMatch[0].length);
  }

  // Strip trailing code fence.
  const fenceEndMatch = s.match(/\n```\s*$/);
  if (fenceEndMatch) {
    s = s.slice(0, fenceEndMatch.index);
  }

  // Strip leading "Here is..." or similar preamble.
  s = s.replace(
    /^(?:here['']?s?\s+(?:is\s+)?(?:the|your)?\s*(?:updated|new)?\s*(?:score|code)?:?\s*\n+)/i,
    '',
  );

  return s.trim();
};

/**
 * История диалога (max 10 последних turns).
 * Каждый turn — одна user или assistant message.
 */
export type DialogTurn = {
  readonly role: 'user' | 'assistant';
  readonly content: string;
};

/**
 * useCase: применить инструкцию пользователя к текущему score.
 * Принимает историю диалога — LLM получает её как messages array и помнит
 * контекст (например "это не Creep" или "я уже просил бас").
 */
export const applyEdit = (
  currentScore: string,
  instruction: string,
  history: ReadonlyArray<DialogTurn> = [],
): Effect.Effect<string, Error | string, LLMClient> =>
  Effect.gen(function* () {
    const llm = yield* LLMClient;

    // Build messages array: history + current request.
    // History ограничена до последних 10 turns чтобы не переполнять контекст.
    const recentHistory = history.slice(-10);
    const messages = [
      ...recentHistory.map((t, i) => ({
        id: `hist-${i}`,
        role: t.role,
        content: t.content,
        ts: 0,
      })),
      {
        id: `user-${Date.now()}`,
        role: 'user' as const,
        content: buildUserPrompt(currentScore, instruction),
        ts: Date.now(),
      },
    ];

    const stream = yield* llm.streamCompletion({
      model: 'smart',
      systemPrompt: SYSTEM_PROMPT,
      messages,
    });

    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let raw = '';

    while (true) {
      const { done, value } = yield* Effect.tryPromise(() => reader.read());
      if (done) break;
      if (value && value.type === 'text' && value.delta) {
        raw += decoder.decode(new TextEncoder().encode(value.delta));
      }
    }

    yield* Effect.tryPromise({
      try: () => reader.cancel(),
      catch: () => undefined,
    }).pipe(Effect.ignore);

    return cleanLLMResponse(raw);
  });