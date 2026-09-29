import { Effect } from 'effect';
import { LLMClient } from '~/domain/services';

/**
 * System prompt для wavecode AI-редактора.
 * Строго описывает формат вывода и ограничения Strudel.
 */
export const SYSTEM_PROMPT = [
  'Ты — wavecode, AI-ассистент для live-coding музыки в Strudel (https://strudel.cc).',
  'Strudel — JS-порт TidalCycles в браузере через Web Audio API.',
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
  'СИНТАКСИС Strudel:',
  '- note("c4") — нота по имени. Можно числами (MIDI: 55=G3, 60=C4, 67=G4) или именами (c4, eb5, f#3).',
  '- n("...") — MIDI числа.',
  '- s("bd sd hh") — сэмплы по имени. Drum-сэмплы Strudel (bd, sd, hh, oh, cp) работают.',
  '- .s("sawtooth"|"sine"|"square"|"triangle") — выбор синтезатора. БЕЗ .s() тишина.',
  '- .gain(0..1) — громкость, .lpf(hz) — low-pass, .decay(s) — огибающая.',
  '',
  'Mini-notation (внутри кавычек):',
  '- "[a b c]" — три ноты ОДНОВРЕМЕННО (аккорд)',
  '- "<a b c>" — последовательность по шагам цикла (один шаг = одна нота)',
  '- "*n" — повторить n раз',
  '- "~" — пауза',
  '- "a, b c" — несколько параллельных голосов в одном pattern (polyphony)',
  '',
  'Композиция:',
  '- stack(pat1, pat2, ...) — наложить patterns',
  '- .slow(2) — замедлить в 2 раза, .fast(2) — ускорить',
  '- .every(n, fn) — применять fn каждый n-ый цикл',
  '- .sometimes(fn) — применять fn в 50% циклов',
  '- .jux(fn) — применить fn к правому каналу',
  '',
  'ПРИМЕРЫ ПРАВИЛЬНЫХ ОТВЕТОВ:',
  'User: "добавь бас"',
  '  Возьми текущий score, добавь bass через stack(...):',
  '  stack(<current_score>, note("g2 b2 c3 c3").s("sawtooth").gain(0.4).lpf(400).slow(2))',
  '',
  'User: "сделай быстрее"',
  '  Добавь .fast(2) к существующим patterns.',
  '',
  'User: "добавь гармонию"',
  '  Расширь арпеджио вверх через <...>*2 с добавленной октавой.',
  '',
  'User: "убери бас"',
  '  Удали только bass pattern, оставь аккорды как есть.',
  '',
  'Если инструкция вообще не относится к music score — всё равно верни',
  'ТЕКУЩИЙ score без изменений (только если вообще невозможно сохранить).',
].join('\n');

/**
 * Собирает user prompt с текущим score, статусом аудио и инструкцией.
 * Содержит явное напоминание: "МОДИФИЦИРУЙ, а НЕ переписывай с нуля".
 *
 * Используем string concatenation с literal triple backticks — это гарантирует
 * что LLM получает правильный markdown code block в userMsg.
 */
export const buildUserPrompt = (
  currentScore: string,
  instruction: string,
  audioState: { status: string; lastError?: string } = { status: 'unknown' },
): string => {
  const lastErrorLine = audioState.lastError
    ? `last_error: ${audioState.lastError}\n`
    : '';
  return [
    '=== ТЕКУЩИЙ SCORE (это БАЗА, модифицируй её) ===',
    '```',
    currentScore,
    '```',
    '',
    '=== СОСТОЯНИЕ АУДИО ===',
    `status: ${audioState.status}`,
    lastErrorLine,
    '',
    '=== ИНСТРУКЦИЯ ПОЛЬЗОВАТЕЛЯ ===',
    instruction,
    '',
    '=== ЗАДАЧА ===',
    'Верни МОДИФИЦИРОВАННЫЙ ПОЛНЫЙ score — это база плюс твоя правка.',
    'Сохрани все ноты/аккорды, которые НЕ упомянуты в инструкции. Измени ТОЛЬКО то что просит пользователь.',
    'Если инструкция неприменима к score — верни базу без изменений.',
    'Только JS код, без markdown и пояснений.',
  ].join('\n');
};

/**
 * Очищает ответ LLM от reasoning-блоков, markdown-обёрток и преамбул.
 *
 * Работает с потенциально ОБОРВАННЫМИ reasoning-блоками (если LLM
 * превысил max_tokens при длинном thinking).
 */
export const cleanLLMResponse = (raw: string): string => {
  let s = raw.trim();

  // 1. Balanced <think>...</think> блоки (DeepSeek-style reasoning).
  s = s.replace(/<think>[\s\S]*?<\/think>/gi, '');

  // 2. Unbalanced <think> без закрытия: модель оборвалась на reasoning — ответ ненадёжный.
  //    Возвращаем пустую строку, чтобы caller залогировал ошибку.
  if (/<think>/i.test(s)) {
    return '';
  }

  // 3. Strip leading "Here is..." preamble (до fence, иначе regex не сматчит).
  s = s.replace(
    /^(?:here['']?s?\s+(?:is\s+)?(?:the|your)?\s*(?:updated|new)?\s*(?:score|code)?:?\s*\n+)/i,
    '',
  );

  // 4. Strip markdown code fence at start.
  const fenceStartMatch = s.match(/^```(?:js|javascript|ts|typescript|strudel)?\s*\n/i);
  if (fenceStartMatch) {
    s = s.slice(fenceStartMatch[0].length);
  }

  // 5. Strip trailing code fence.
  const fenceEndMatch = s.match(/\n```\s*$/);
  if (fenceEndMatch) {
    s = s.slice(0, fenceEndMatch.index);
  }

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
  audioState: { status: string; lastError?: string } = { status: 'unknown' },
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
        content: buildUserPrompt(currentScore, instruction, audioState),
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