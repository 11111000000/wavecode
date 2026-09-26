import { Effect } from 'effect';
import { LLMClient } from '~/domain/services';

/**
 * System prompt для wavecode AI-редактора.
 * Строго описывает формат вывода и ограничения Strudel.
 */
export const SYSTEM_PROMPT = `Ты — wavecode, AI-ассистент для live-coding музыки на Strudel (https://strudel.cc).
Strudel — это JavaScript-порт TidalCycles, работающий в браузере через Web Audio API.

ОСНОВНЫЕ ФУНКЦИИ:
- s(name) — выбрать источник звука
- n(midi) — паттерн MIDI-нот (например n("0 ~ 2 ~ 4"))
- note("c4") — статичная нота (без mini-notation)
- pattern("...") — паттерн mini-notation
- stack(...patterns) — наложить паттерны
- .slow(n) — замедлить в n раз
- .fast(n) — ускорить в n раз
- .gain(value) — громкость (0..1)
- .add(n) — транспозиция на n полутонов
- .every(n, fn) — применять fn каждый n-й цикл
- .s("sine"/"sawtooth"/"square"/"triangle") — встроенные синтезаторы (samples не подгружены!)
- .lpf(hz) — low-pass фильтр
- .hush() — остановить всё

ПРАВИЛА ВЫВОДА:
1. Верни ТОЛЬКО JS-код паттерна, без markdown-блоков, без объяснений.
2. Используй встроенные синтезаторы (sine, sawtooth, square, triangle). Без drum-сэмплов.
3. Сохраняй комментарии если они осмыслены.
4. Не используй функции, требующие загрузки сэмплов (s("bd") и т.п. — не загружены).`;

/**
 * Собирает user prompt с текущим score и инструкцией.
 */
export const buildUserPrompt = (currentScore: string, instruction: string): string =>
  `ТЕКУЩИЙ SCORE:\n\`\`\`\n${currentScore}\n\`\`\`\n\nИНСТРУКЦИЯ ПОЛЬЗОВАТЕЛЯ:\n${instruction}\n\nВерни новый score (только JS-код, без markdown):`;

/**
 * Очищает ответ LLM от markdown-блоков и лишних обёрток.
 * Модели любят возвращать \`\`\`js ... \`\`\` несмотря на инструкции.
 */
export const cleanLLMResponse = (raw: string): string => {
  let s = raw.trim();

  // Strip leading "Here is..." or similar preamble
  const codeBlockStart = s.match(/^```(?:js|javascript|ts|typescript)?\s*\n/i);
  if (codeBlockStart) {
    s = s.slice(codeBlockStart[0].length);
  } else {
    // If no code block, try to strip "Here's the updated score:\n\n" or similar
    const preambleMatch = s.match(/^(?:here['']?s?\s+(?:is\s+)?(?:the|your)\s+(?:updated|new)\s+score:?\s*\n+)/i);
    if (preambleMatch) s = s.slice(preambleMatch[0].length);
  }

  // Strip trailing code fence
  const fenceEnd = s.match(/\n```\s*$/);
  if (fenceEnd) s = s.slice(0, fenceEnd.index);

  return s.trim();
};

/**
 * useCase: применить инструкцию пользователя к текущему score.
 * Возвращает новый score.
 */
export const applyEdit = (
  currentScore: string,
  instruction: string,
): Effect.Effect<string, Error | string, LLMClient> =>
  Effect.gen(function* () {
    const llm = yield* LLMClient;

    const stream = yield* llm.streamCompletion({
      model: 'smart',
      systemPrompt: SYSTEM_PROMPT,
      messages: [
        {
          id: `user-${Date.now()}`,
          role: 'user',
          content: buildUserPrompt(currentScore, instruction),
          ts: Date.now(),
        },
      ],
    });

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let raw = '';

  // eslint-disable-next-line no-constant-condition
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