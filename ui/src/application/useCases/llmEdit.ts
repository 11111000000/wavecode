import { Effect, type Context } from 'effect';
import { LLMClient } from '~/domain/services';
import { parseScore } from '~/domain/strudel';

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
  '  s("sawtooth")                  — форма волны (sawtooth/sine/square/triangle/white/brown)',
  '  s("sbd")                       — синтезированный bass drum (superdough registerSynthSounds)',
  '',
  'Sample-based drums (требуют зарегистрированный sample bank):',
  '  s("bd" | "sd" | "hh" | "oh" | "cp")           — короткие имена,',
  '  s("drums_bd" | "drums_sd" | "drums_hh" | ...)  — bank-prefix,',
  '  s("github:user/repo")                        — external sample pack.',
  '  В wavecode банк "drums_*" загружается автоматически через SampleLoader;',
  '  короткие "bd" / "sd" / "hh" / "oh" / "cp" без банка упадут с "sound not found".',
  '  Используй sbd для гарантированного звука, drums_* для полноценного kit,',
  '  и sawtooth/sine/square/triangle для не-ударных голосов.',
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
 * System prompt for the self-heal retry. Given the user's original
 * score, the LLM's broken first attempt, and a parser-side reason
 * for the rejection, the model is asked to return a syntactically
 * valid Strudel score that still reflects the original instruction.
 */
export const FIX_SYSTEM_PROMPT = [
  'Ты — wavecode, AI-ассистент для live-coding музыки в Strudel.',
  'Ты получил ИСХОДНЫЙ score и ИНСТРУКЦИЮ, но твой ПРЕДЫДУЩИЙ ОТВЕТ',
  'не прошёл синтаксический разбор парсером. Нужно вернуть',
  'ИСПРАВЛЕННУЮ ВЕРСИЮ, которая:',
  '  1. Парсится как валидный Strudel score (balanced parens, valid args).',
  '  2. Сохраняет смысл исходной инструкции.',
  '  3. Не добавляет markdown, преамбул, <think>блоков.',
  '',
  'Верни ТОЛЬКО ИСПРАВЛЕННЫЙ JS — никаких пояснений.',
].join('\n');

/**
 * Собирает user prompt с текущим score, статусом аудио и инструкцией.
 * Содержит явное напоминание: "МОДИФИЦИРУЙ, а НЕ переписывай с нуля".
 *
 * Используем string concatenation с literal triple backticks — это гарантирует
 * что LLM получает правильный markdown code block в userMsg.
 *
 * wavecode-editor-selection-ai: when `focusedContext` is non-null,
 * a `=== FOCUSED CONTEXT ===` block is inserted BEFORE the audio
 * state and the instruction, so the model sees the user's
 * structural scope first and can scope its edit accordingly.
 * When `focusedContext === null` (the default), the prompt is
 * byte-identical to the prior version — verified by the
 * existing `llmEdit.test.ts` cases passing unchanged.
 */
export type FocusedContextLike = {
  readonly kind: 'function-call' | 'stack-row' | 'text';
  readonly text: string;
  readonly name?: string | null;
};

export const buildUserPrompt = (
  currentScore: string,
  instruction: string,
  audioState: { status: string; lastError?: string } = { status: 'unknown' },
  focusedContext: FocusedContextLike | null = null,
): string => {
  const lastErrorLine = audioState.lastError
    ? `last_error: ${audioState.lastError}\n`
    : '';
  const focusBlock = focusedContext === null
    ? ''
    : [
        '',
        '=== FOCUSED CONTEXT (apply edits to this scope) ===',
        `kind: ${focusedContext.kind}`,
        ...(focusedContext.kind === 'function-call' && focusedContext.name
          ? [`name: ${focusedContext.name}`]
          : focusedContext.kind === 'stack-row'
            ? [
                ...(focusedContext.name ? [`name: ${focusedContext.name}`] : []),
              ]
            : []),
        '```',
        focusedContext.text,
        '```',
      ].join('\n');
  return [
    '=== ТЕКУЩИЙ SCORE (это БАЗА, модифицируй её) ===',
    '```',
    currentScore,
    '```',
    focusBlock,
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
    ...(focusedContext !== null
      ? ['Применяй правку к FOCUSED CONTEXT (см. выше), а остальное оставь как было.']
      : []),
    'Только JS код, без markdown и пояснений.',
  ].join('\n');
};

/**
 * Builds the user prompt for the self-heal retry. We re-use the
 * original instruction so the model still knows the user's intent,
 * but supply the broken attempt and the parser-side rejection so it
 * can spot the specific defect (unbalanced parens, dropped token,
 * half-finished stack, etc.).
 */
export const buildFixPrompt = (
  currentScore: string,
  instruction: string,
  brokenAttempt: string,
  parseError: string,
): string => {
  return [
    '=== ТЕКУЩИЙ SCORE (БАЗА) ===',
    '```',
    currentScore,
    '```',
    '',
    '=== ИНСТРУКЦИЯ ПОЛЬЗОВАТЕЛЯ ===',
    instruction,
    '',
    '=== ТВОЙ ПРЕДЫДУЩИЙ ОТВЕТ (СЛОМАН) ===',
    '```',
    brokenAttempt,
    '```',
    '',
    '=== ПОЧЕМУ СЛОМАНО ===',
    parseError,
    '',
    '=== ЗАДАЧА ===',
    'Верни ИСПРАВЛЕННЫЙ полный score, который парсится как валидный Strudel',
    'и сохраняет смысл исходной инструкции. Только JS код, без markdown и пояснений.',
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
 * Hard cap on the number of self-heal retries per `applyEditStream`
 * invocation. The LLM might produce a perpetually broken score (e.g.
 * a model that does not understand Strudel at all); without this
 * cap we would loop forever. One retry covers the common case where
 * the model ran out of token budget during reasoning and emitted
 * half a `stack(…`.
 *
 * See `decisions/wavecode-ai-streaming-and-self-heal.yaml`
 * `obligation: self-heal-budget-is-one`.
 */
export const SELF_HEAL_RETRY_BUDGET = 1;

/**
 * Callbacks for `applyEditStream`. Each is invoked at most once per
 * lifecycle event (`onToken` may be called many times — once per
 * delta from the LLM stream). The semantics match `ReadableStream`
 * reader's `pull` events: tokens arrive as soon as the LLM emits
 * them, complete fires once the stream finishes, error fires once
 * if the request fails or the self-heal exhausts the retry budget.
 */
export type ApplyEditCallbacks = {
  readonly onToken?: (text: string) => void;
  readonly onComplete?: (result: ApplyEditResult) => void;
  readonly onError?: (err: Error) => void;
};

/**
 * Result of `applyEditStream`. `wasHealed` is `true` iff the LLM's
 * first response was AST-invalid and the single retry succeeded;
 * `false` if the first attempt was already valid. `attempts` counts
 * the LLM round-trips used (1 = happy path, 2 = self-heal).
 */
export type ApplyEditResult = {
  readonly score: string;
  readonly wasHealed: boolean;
  readonly attempts: 1 | 2;
};

/**
 * Structural check over the cleaned score text + AST. We treat a
 * score as broken iff:
 *
 *   (a) `parseScore` returns an AST with no `StackNode` or
 *       `CallNode` (pure CommentNode/OtherNode soup — the parser
 *       never throws, it captures unparseable input as OtherNode);
 *   (b) the cleaned source text has unbalanced parens
 *       (open/close mismatch).
 *
 * Note: `validateForEdit` is intentionally NOT used because it
 * requires exactly 4 `s(…)` rows in a top-level stack — most
 * wavecode edits legitimately produce single-pattern scores.
 *
 * See `decisions/wavecode-ai-streaming-and-self-heal.yaml`
 * `assumption: ast-failure-means-broken-score`.
 */
export const isScoreBroken = (cleaned: string): { broken: boolean; reason: string } => {
  const trimmed = cleaned.trim();
  if (!trimmed) {
    return { broken: true, reason: 'empty after cleaning' };
  }
  // (b) Paren balance — fast syntactic sanity check.
  const open = (trimmed.match(/\(/g) ?? []).length;
  const close = (trimmed.match(/\)/g) ?? []).length;
  if (open !== close) {
    return {
      broken: true,
      reason: `unbalanced parens (${open} open vs ${close} close)`,
    };
  }
  // (a) AST structural check.
  const ast = parseScore(trimmed);
  const hasCall = ast.nodes.some((n) => n.kind === 'stack' || n.kind === 'call');
  if (!hasCall) {
    return {
      broken: true,
      reason: 'parseScore found no StackNode/CallNode (only comments / junk)',
    };
  }
  return { broken: false, reason: 'ok' };
};

/**
 * useCase: применить инструкцию пользователя к текущему score
 * (back-compat surface). Returns the cleaned score string.
 *
 * Internally routes through `applyEditStream` without callbacks.
 * Existing callers (AIEditPanel, llmEdit.test.ts) see no change.
 */
export const applyEdit = (
  currentScore: string,
  instruction: string,
  history: ReadonlyArray<DialogTurn> = [],
  audioState: { status: string; lastError?: string } = { status: 'unknown' },
  options: { model?: 'smart' | 'fast'; thinking?: 'low' | 'high' | 'off' } = {},
): Effect.Effect<string, Error | string, LLMClient> =>
  Effect.gen(function* () {
    const result = yield* applyEditStream(currentScore, instruction, history, audioState, options);
    return result.score;
  });

/**
 * useCase: streaming variant of `applyEdit` that surfaces LLM
 * tokens in real time and self-heals once on AST-invalid responses.
 *
 * Lifecycle:
 *   1. Build messages array from history + the user's instruction.
 *   2. Call `llm.streamCompletion` and read every chunk; accumulate
 *      raw text and forward each `delta` to `onToken` (if provided).
 *   3. Clean the raw text via `cleanLLMResponse`.
 *   4. Validate the cleaned score through `isScoreBroken`. If broken,
 *      retry ONCE with `buildFixPrompt` + the broken attempt + parse
 *      error. The retry's cleaned text is validated the same way.
 *   5. On success, invoke `onComplete` with the result. On hard
 *      failure (request error OR retry-budget exhaustion), invoke
 *      `onError` and reject the Effect.
 *
 * The retry budget is `SELF_HEAL_RETRY_BUDGET = 1` — no infinite
 * loops, no extra LLM cost beyond one regenerator call.
 */
export const applyEditStream = (
  currentScore: string,
  instruction: string,
  history: ReadonlyArray<DialogTurn> = [],
  audioState: { status: string; lastError?: string } = { status: 'unknown' },
  options: { model?: 'smart' | 'fast'; thinking?: 'low' | 'high' | 'off' } = {},
  callbacks: ApplyEditCallbacks = {},
  context: FocusedContextLike | null = null,
): Effect.Effect<ApplyEditResult, Error | string, LLMClient> =>
  Effect.gen(function* () {
    const llm = yield* LLMClient;

    const recentHistory = history.slice(-10);
    const userMessage = {
      id: `user-${Date.now()}`,
      role: 'user' as const,
      content: buildUserPrompt(currentScore, instruction, audioState, context),
      ts: Date.now(),
    };
    const baseMessages = [
      ...recentHistory.map((t, i) => ({
        id: `hist-${i}`,
        role: t.role,
        content: t.content,
        ts: 0,
      })),
      userMessage,
    ];

    // === Attempt 1: standard edit ===
    const firstRaw = yield* readStream(
      llm,
      {
        model: options.model ?? 'smart',
        thinking: options.thinking ?? 'low',
        systemPrompt: SYSTEM_PROMPT,
        messages: baseMessages,
      },
      callbacks.onToken,
    );

    const firstCleaned = cleanLLMResponse(firstRaw);
    setLastRawLLMResponse(firstRaw);

    const firstCheck = isScoreBroken(firstCleaned);
    if (!firstCheck.broken) {
      const result: ApplyEditResult = { score: firstCleaned, wasHealed: false, attempts: 1 };
      callbacks.onComplete?.(result);
      return result;
    }

    // === Attempt 2: self-heal retry (budget = 1) ===
    const fixMessages = [
      ...baseMessages,
      {
        id: `assistant-${Date.now()}`,
        role: 'assistant' as const,
        content: firstCleaned,
        ts: Date.now(),
      },
      {
        id: `fix-${Date.now()}`,
        role: 'user' as const,
        content: buildFixPrompt(currentScore, instruction, firstCleaned, firstCheck.reason),
        ts: Date.now(),
      },
    ];

    const secondRaw = yield* readStream(
      llm,
      {
        model: options.model ?? 'smart',
        thinking: options.thinking ?? 'low',
        systemPrompt: FIX_SYSTEM_PROMPT,
        messages: fixMessages,
      },
      callbacks.onToken,
    );

    const secondCleaned = cleanLLMResponse(secondRaw);
    const secondCheck = isScoreBroken(secondCleaned);

    if (secondCheck.broken) {
      // Budget exhausted — surface the second parse error.
      const err = new Error(
        `LLM self-heal failed: ${secondCheck.reason}. Original attempt: ${firstCheck.reason}.`,
      );
      callbacks.onError?.(err);
      return yield* Effect.fail(err);
    }

    const result: ApplyEditResult = { score: secondCleaned, wasHealed: true, attempts: 2 };
    // Stash the final (healed) response for the same diagnostic UI
    // that reads `getLastRawLLMResponse()` to surface "ИИ вернул
    // пустой ответ" on hard failure.
    setLastRawLLMResponse(secondRaw);
    callbacks.onComplete?.(result);
    return result;
  });

/**
 * Read every chunk from the LLM client's streamCompletion, accumulate
 * the raw text, and forward each delta to `onToken` (if provided).
 *
 * Kept as a private helper so `applyEditStream` and the back-compat
 * `applyEdit` share the exact same streaming semantics.
 */
const readStream = (
  llm: Context.Tag.Service<typeof LLMClient>,
  request: Parameters<typeof llm.streamCompletion>[0],
  onToken: ((text: string) => void) | undefined,
): Effect.Effect<string, Error | string, LLMClient> =>
  Effect.gen(function* () {
    const stream = yield* llm.streamCompletion(request);
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let raw = '';
    try {
      while (true) {
        const { done, value } = yield* Effect.tryPromise(() => reader.read());
        if (done) break;
        if (value && value.type === 'text' && value.delta) {
          const decoded = decoder.decode(new TextEncoder().encode(value.delta), { stream: false });
          raw += decoded;
          onToken?.(decoded);
        }
      }
    } finally {
      yield* Effect.tryPromise({
        try: () => reader.cancel(),
        catch: () => undefined,
      }).pipe(Effect.ignore);
    }
    return raw;
  });

/**
 * wavecode-editor-selection-ai: same effect as `applyEdit`, but
 * with an additional `focusedContext` argument that is appended
 * to the user prompt as a `=== FOCUSED CONTEXT ===` block.
 *
 * Backward-compat:
 *   - Old callers (`applyEdit(score, instr, hist, audio, opts)`)
 *     continue to work — the new function is purely additive.
 *   - When `context === null` the prompt is byte-identical to
 *     `applyEdit` (verified by `llmEdit.test.ts`).
 *   - The streaming path now mirrors `applyEditStream`: tokens
 *     are surfaced to `callbacks.onToken` (if provided) and the
 *     final raw response is published via the same `getLastRawLLMResponse`
 *     diagnostic accessor that `applyEditStream` uses. Previously
 *     this function hand-rolled its own reader loop and ignored
 *     streaming callbacks, which made the focused-context flow
 *     visibly less responsive than the standard flow.
 *
 * The context shape mirrors `FocusedContext` from
 * `presentation/state/editorSelection.ts` but is inlined here
 * to keep the application layer free of presentation imports
 * (the `application/` folder does NOT import from
 * `presentation/` per the strict-layering decision
 * `wavecode-strict-layering`).
 */
export const applyEditWithContext = (
  currentScore: string,
  instruction: string,
  history: ReadonlyArray<DialogTurn> = [],
  audioState: { status: string; lastError?: string } = { status: 'unknown' },
  options: { model?: 'smart' | 'fast'; thinking?: 'low' | 'high' | 'off' } = {},
  context: FocusedContextLike | null = null,
  callbacks: ApplyEditCallbacks = {},
): Effect.Effect<string, Error | string, LLMClient> =>
  Effect.gen(function* () {
    const llm = yield* LLMClient;

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
        content: buildUserPrompt(currentScore, instruction, audioState, context),
        ts: Date.now(),
      },
    ];

    const raw = yield* readStream(
      llm,
      {
        model: options.model ?? 'smart',
        thinking: options.thinking ?? 'low',
        systemPrompt: SYSTEM_PROMPT,
        messages,
      },
      callbacks.onToken,
    );

    setLastRawLLMResponse(raw);
    return cleanLLMResponse(raw);
  });

/**
 * Last raw LLM response (для отладки/UI).
 *
 * Stored as a module-scope variable rather than on `window` so the
 * value cannot leak via DevTools' `window.*` autocompletion and so
 * parallel `applyEditStream` / `applyEditWithContext` invocations
 * don't race on a global mutable property. Set via
 * `setLastRawLLMResponse` (private) from the streaming effects.
 */
let lastRawLLMResponse = '';

const setLastRawLLMResponse = (raw: string): void => {
  lastRawLLMResponse = raw;
};

export const getLastRawLLMResponse = (): string => lastRawLLMResponse;