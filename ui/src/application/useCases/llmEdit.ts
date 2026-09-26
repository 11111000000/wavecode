import { Effect } from 'effect';
import { LLMClient } from '~/domain/services';

/**
 * System prompt для wavecode AI-редактора.
 * Строго описывает формат вывода и ограничения Strudel.
 */
export const SYSTEM_PROMPT = `Ты — wavecode, AI-ассистент для live-coding музыки на Strudel (https://strudel.cc).
Strudel — это JavaScript-порт TidalCycles, работающий в браузере через Web Audio API.

⚠️ ВАЖНО: drum-сэмплы ("bd", "sd", "hh" и т.п.) НЕ загружены. Используй ТОЛЬКО встроенные синтезаторы через .s("sine"/"sawtooth"/"square"/"triangle"). Если нужны drum-звуки — скажи пользователю что они недоступны.

⚠️ note("c4") принимает ОДНУ ноту, не последовательность. Для аккорда используй stack(): stack(note("c4"), note("e4"), note("g4")).

ФУНКЦИИ:
- n("0 ~ 2 ~ 4") — паттерн MIDI-нот (мини-нотация поддерживается!)
- note("c4") — ОДНА статичная нота. НЕ note("c4 e4 g4")!
- s("sine") — выбрать синтезатор
- stack(...) — наложить паттерны
- .slow(n) — замедлить в n раз
- .fast(n) — ускорить в n раз
- .gain(v) — громкость (0..1)
- .add(n) — транспозиция на n полутонов
- .lpf(hz) — low-pass фильтр
- .hpf(hz) — high-pass фильтр
- .delay(0.5) — delay effect
- .rev(0.5) — reverb
- .every(n, fn) — применять fn каждый n-й цикл
- .hush() — остановить всё

ПРИМЕРЫ:
- Простой звук: note("c4").s("sine")
- Аккорд: stack(note("c4"), note("e4"), note("g4")).s("sawtooth")
- Паттерн: n("0 ~ 2 ~ 4 0 ~ 3").s("triangle").slow(2)
- С фильтром: n("0 2 4 5 7 9 11").s("sawtooth").lpf(800).gain(0.3)

ПРАВИЛА ВЫВОДА:
1. Верни ТОЛЬКО JS-код паттерна.
2. Без markdown-блоков (\`\`\`js ... \`\`\`).
3. Без пояснений и преамбул ("Here is the updated score:").
4. Без блоков <think>...</think>.
5. Используй встроенные синтезаторы. Без drum-сэмплов.
6. note() принимает ОДНУ ноту. Для аккорда — stack(note(), note(), note()).`;

/**
 * Собирает user prompt с текущим score и инструкцией.
 */
export const buildUserPrompt = (currentScore: string, instruction: string): string =>
  `ТЕКУЩИЙ SCORE:\n\`\`\`\n${currentScore}\n\`\`\`\n\nИНСТРУКЦИЯ ПОЛЬЗОВАТЕЛЯ:\n${instruction}\n\nВерни новый score (только JS-код, без markdown):`;

/**
 * Очищает ответ LLM от markdown-блоков, reasoning-blocks и preamble/postamble.
 *
 * Модели (особенно DeepSeek-style с reasoning_content) любят добавлять:
 *   - <think>...</think> блоки размышлений
 *   - ```js ... ``` markdown обёртки
 *   - "Here is the updated score:" преамбулу
 *
 * Извлекаем только JS-код Strudel-паттерна.
 */
export const cleanLLMResponse = (raw: string): string => {
  let s = raw.trim();

  // Strip ALL <think>...</think> blocks (DeepSeek-style reasoning).
  // Use [\s\S] instead of . for multiline matching.
  s = s.replace(/<think>[\s\S]*?<\/think>/gi, '');

  // Strip markdown code fences at the start: ```js, ```javascript, ```ts, etc.
  const fenceStartMatch = s.match(/^```(?:js|javascript|ts|typescript|strudel)?\s*\n/i);
  if (fenceStartMatch) {
    s = s.slice(fenceStartMatch[0].length);
  }

  // Strip trailing code fence
  const fenceEndMatch = s.match(/\n```\s*$/);
  if (fenceEndMatch) {
    s = s.slice(0, fenceEndMatch.index);
  }

  // Strip leading "Here is..." or similar preamble (after reasoning removed).
  s = s.replace(
    /^(?:here['']?s?\s+(?:is\s+)?(?:the|your)?\s*(?:updated|new)?\s*(?:score|code)?:?\s*\n+)/i,
    '',
  );

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