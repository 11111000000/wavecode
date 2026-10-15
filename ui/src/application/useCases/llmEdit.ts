import { Effect } from 'effect';
import { LLMClient } from '~/domain/services';

/**
 * System prompt для wavecode AI-редактора.
 * Строго описывает формат вывода и ограничения Strudel.
 */
export const SYSTEM_PROMPT = [
  'Ты — wavecode, AI-ассистент для live-coding музыки в Strudel (https://strudel.cc).',
  'Strudel — JS-порт TidalCycles, работает в браузере через Web Audio API.',
  '',
  '=== ГЛАВНОЕ ПРАВИЛО: СОХРАНЯЙ СУЩЕСТВУЮЩЕЕ, ДОБАВЛЯЙ НОВОЕ ===',
  'Текущий score пользователя — это БАЗА. Ты НЕ переписываешь его с нуля.',
  'Каждый pattern, который был в текущем score и НЕ упомянут в инструкции,',
  'ДОЛЖЕН присутствовать в твоём ответе БЕЗ ИЗМЕНЕНИЙ (можно обернуть в stack).',
  '',
  'ПРАВИЛА РЕДАКТИРОВАНИЯ:',
  '• "добавь X" → ОБЕРНИ существующее в stack(...) и добавь X. НЕ трогай остальное.',
  '• "убери X" → удали только X, остальное оставь как было.',
  '• "измени X" → измени только X, остальное копируй ПОСИМВОЛЬНО из текущего.',
  '• "сделай быстрее/громче/медленнее" → добавь .fast()/.gain()/.slow() к существующему.',
  '',
  'ПРАВИЛА ВЫВОДА:',
  '1. Верни ПОЛНЫЙ финальный score (не diff, не фрагмент).',
  '2. Никакого markdown, преамбул, <think>блоков. Только JS.',
  '',
  '=== СИНТАКСИС Strudel ===',
  '',
  'Mini-notation (внутри кавычек):',
  '  "55 59 62"      — sequence (3 ноты по очереди, каждая 1/3 цикла)',
  '  "[55,59,62]"    — chord (3 ноты ОДНОВРЕМЕННО)',
  '  "<a b c d>"     — sequence из 4 шагов в цикл',
  '  "~"             — пауза (rest)',
  '  "*n"            — повторить n раз (например "55*4")',
  '  "a, b c"        — параллельные голоса (polyphony)',
  '',
  'Основные функции:',
  '  note("c4") / note("55 59 62")  — нота по имени или MIDI числами',
  '  n("...")                       — то же что note(), но только MIDI числа',
  '  s("sawtooth")                 — форма волны (sine/sawtooth/square/triangle)',
  '  s("sbd")                      — синтезированный bass drum (РАБОТАЕТ ВСЕГДА)',
  '  sbd — единственный синтезированный ударный в Strudel по умолчанию.',
  '  ⚠️ НЕ используй bd/sd/hh/oh/cp — это sample-based, требуют сеть.',
  '  .gain(0..1)   — громкость',
  '  .lpf(hz)      — low-pass фильтр',
  '  .slow(n)      — замедлить в n раз',
  '  .fast(n)      — ускорить в n раз',
  '  .decay(s)     — огибающая затухания',
  '',
  'Композиция:',
  '  stack(pat1, pat2, ...) — параллельные дорожки (chords + bass + drums)',
  '',
  '=== ПРИМЕРЫ: ADDITIVE EDITING ===',
  '',
  'Текущий score (для примеров):',
  '  note("<[55,59,62] [59,63,66] [60,64,67] [60,63,67]>").s("sawtooth").gain(0.4)',
  '',
  'User: "добавь басовую линию"',
  '  Правильный ответ:',
  '  stack(',
  '    note("<[55,59,62] [59,63,66] [60,64,67] [60,63,67]>").s("sawtooth").gain(0.4),',
  '    note("<g2 b2 c3 c3>").s("sawtooth").gain(0.35).lpf(400)',
  '  )',
  '',
  'User: "добавь бит (drum pattern)"',
  '  Правильный ответ:',
  '  stack(',
  '    note("<[55,59,62] [59,63,66] [60,64,67] [60,63,67]>").s("sawtooth").gain(0.4),',
  '    s("sbd*4").gain(0.5)',
  '  )',
  '',
  'User: "добавь простую мелодию на октаву выше"',
  '  Правильный ответ:',
  '  stack(',
  '    note("<[55,59,62] [59,63,66] [60,64,67] [60,63,67]>").s("sawtooth").gain(0.4),',
  '    note("<67 71 74 72>").s("sine").gain(0.2)',
  '  )',
  '',
  'User: "сделай быстрее"',
  '  Правильный ответ (добавь .fast(2) к существующему):',
  '  note("<[55,59,62] [59,63,66] [60,64,67] [60,63,67]>").s("sawtooth").gain(0.4).fast(2)',
  '',
  'User: "добавь reverb"',
  '  Правильный ответ (добавь .room(.5) к существующему):',
  '  note("<[55,59,62] [59,63,66] [60,64,67] [60,63,67]>").s("sawtooth").gain(0.4).room(.5)',
  '',
  '=== ПОСЛЕДНЕЕ ===',
  'Если инструкция не относится к music — верни ТЕКУЩИЙ score без изменений.',
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
/**
 * Чистит ответ LLM от markdown/thinking блоков.
 * Возвращает cleaned строку. Если после чистки ничего не осталось — возвращает
 * raw (trimmed) чтобы caller видел что LLM вообще вернул, а не "пустой ответ".
 *
 * Извлечение кода из prose: если LLM дал ответ вроде "Here's the code:\n<code>"
 * (без code fence), пытаемся найти pattern-блок и вернуть только его.
 */
export const cleanLLMResponse = (raw: string): string => {
  const trimmed = raw.trim();
  let s = trimmed;

  // 1. Balanced <think>...</think> блоки (DeepSeek-style reasoning).
  s = s.replace(/<think>[\s\S]*?<\/think>/gi, '');

  // 2. Unbalanced <think> без закрытия: модель оборвалась на reasoning.
  //    Пробуем извлечь что было ДО <think> (если LLM начала с кода, потом стала думать).
  if (/<think>/i.test(s)) {
    const before = s.slice(0, s.indexOf('<think>')).trim();
    s = before;
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

  const cleaned = s.trim();

  // Если после чистки ничего не осталось — fallback на raw trimmed.
  // Caller увидит хоть что-то и сможет понять что LLM вернул.
  if (!cleaned) return trimmed;

  // Если cleaned выглядит как prose (нет ни одной строчки похожей на JS),
  // пробуем найти pattern-блок между ```...``` или просто строку с `note(`/`s(`/`stack(`.
  const hasJsHint = /(\bstack\s*\(|\bnote\s*\(|\bs\s*\(|\.gain|\.slow|\.fast|\.s\s*\()/.test(cleaned);
  if (!hasJsHint) {
    const fenced = raw.match(/```(?:js|javascript|ts|typescript|strudel)?\s*\n([\s\S]*?)\n```/i);
    if (fenced && fenced[1]) return fenced[1].trim();
    const noteMatch = raw.match(/(note\s*\([^)]*\.[\s\S]*)/);
    if (noteMatch && noteMatch[1]) return noteMatch[1].trim();
    // Без шансов — возвращаем cleaned (caller сам разберётся)
    return cleaned;
  }

  return cleaned;
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
 * Snapshot of the active Track for LLM-bound work. We pass the
 * `score` and `messages` only — callers don't need the rest of
 * the Track metadata at this layer.
 */
export type ActiveTrackSnapshot = {
  readonly id: string;
  readonly score: string;
  readonly messages: ReadonlyArray<{ readonly role: 'user' | 'assistant' | 'system'; readonly content: string }>;
};

/**
 * useCase: применить инструкцию пользователя к активному треку.
 * Берёт `score` и историю диалога из `activeTrack`; в LLM
 * уходит только этот контекст — другие треки не видны.
 */
export const applyEdit = (
  activeTrack: ActiveTrackSnapshot | undefined,
  instruction: string,
  audioState: { status: string; lastError?: string } = { status: 'unknown' },
  options: { model?: 'smart' | 'fast'; thinking?: 'low' | 'high' | 'off' } = {},
): Effect.Effect<string, Error | string, LLMClient> =>
  Effect.gen(function* () {
    const llm = yield* LLMClient;

    if (!activeTrack) {
      return yield* Effect.fail('no-active-track');
    }

    // Build messages array: history of THIS track only + current request.
    // History ограничена до последних 10 turns чтобы не переполнять контекст.
    const recentHistory = activeTrack.messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .slice(-10);
    const messages = [
      ...recentHistory.map((m, i) => ({
        id: `hist-${i}`,
        role: m.role,
        content: m.content,
        ts: 0,
      })),
      {
        id: `user-${Date.now()}`,
        role: 'user' as const,
        content: buildUserPrompt(activeTrack.score, instruction, audioState),
        ts: Date.now(),
      },
    ];

    const stream = yield* llm.streamCompletion({
      model: options.model ?? 'smart',
      thinking: options.thinking ?? 'low',
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

    // Stash raw response on globalThis so UI может показать что LLM ответил
    // при ошибках (например "ИИ вернул пустой ответ").
    (window as unknown as { __wavecodeLastRaw?: string }).__wavecodeLastRaw = raw;

    const cleaned = cleanLLMResponse(raw);
    // Note: raw/cleaned length diagnostics used to be logged via `console.log`
    // here. Removed in feat/quality-tooling — application/ has no-console:'error',
    // and the raw response is already stashed on globalThis
    // (`__wavecodeLastRaw`, retrieved via getLastRawLLMResponse) for any
    // debug UI that wants it. Verbose logging now flows through the
    // centralised logger (infrastructure/log/*) when wired up.
    return cleaned;
  });

/** Last raw LLM response (для отладки/UI). */
export const getLastRawLLMResponse = (): string =>
  (window as unknown as { __wavecodeLastRaw?: string }).__wavecodeLastRaw ?? '';