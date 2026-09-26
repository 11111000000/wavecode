import { Effect } from 'effect';
import { LLMClient } from '~/domain/services';

/**
 * System prompt для wavecode AI-редактора.
 * Строго описывает формат вывода и ограничения Strudel.
 */
export const SYSTEM_PROMPT = [
  'Ты — wavecode, AI-ассистент для live-coding музыки на Strudel (https://strudel.cc).',
  'Strudel — это JavaScript-порт TidalCycles, работающий в браузере через Web Audio API.',
  '',
  'САМОЕ ВАЖНОЕ — ВЫБЕРИ ПРАВИЛЬНУЮ ФУНКЦИЮ:',
  '- note("c4") — ОДНА статичная нота. Mini-notation НЕ работает!',
  '  ❌ НЕЛЬЗЯ: note("c4 e4 g4"), note("<c4 e4>"), note("[c4,e4,g4]")',
  '  ✅ МОЖНО: note("c4"), note("eb4"), note("f#3")',
  '- n("...") — паттерн MIDI-нот (или нот) с mini-notation. Используй для АККОРДОВ и ПОСЛЕДОВАТЕЛЬНОСТЕЙ!',
  '  ✅ n("<c4 e4 g4>"), n("<[c4,e4,g4] [a4,c5,e5]>"), n("0 ~ 2 ~ 4 0 ~ 3")',
  '- sequence(...patterns) или cat(...patterns) — последовательность паттернов',
  '- stack(...patterns) — параллельное наложение',
  '',
  'ВАЖНО: drum-сэмплы ("bd", "sd", "hh" и т.п.) НЕ загружены. Используй ТОЛЬКО встроенные синтезаторы через .s("sine"/"sawtooth"/"square"/"triangle").',
  '',
  'ВАЖНО: чтобы просто звучать, ОБЯЗАТЕЛЬНО укажи синтезатор через .s(...). Без .s() паттерн молчит!',
  '',
  'СИНТАКСИС MINI-NOTATION:',
  '- "<a b c>" — последовательность (a потом b потом c за один цикл)',
  '- "[a b c]" — аккорд (a, b, c одновременно)',
  '- "<[c4,e4,g4] [a4,c5,e5]>" — последовательность аккордов',
  '- "<a ~ ~ b>" — a, тишина, тишина, b (тишина = ~)',
  '- "a*4" — повторить a 4 раза',
  '- "a/2" — замедлить в 2 раза',
  '',
  'ЭФФЕКТЫ (применяются через .method):',
  '- .s("sine"/"sawtooth"/"square"/"triangle") — встроенные синтезаторы',
  '- .gain(0..1) — громкость',
  '- .slow(n) — замедлить в n раз',
  '- .fast(n) — ускорить в n раз',
  '- .add(n) — транспозиция на n полутонов',
  '- .lpf(hz) — low-pass фильтр (срезает выше hz)',
  '- .hpf(hz) — high-pass фильтр',
  '- .delay(0.5) — delay effect',
  '- .rev(0.5) — reverb',
  '- .every(n, fn) — применять fn каждый n-й цикл',
  '- .hush() — остановить всё',
  '',
  'ПРИМЕРЫ (правильный синтаксис):',
  '- Простой звук: note("c4").s("sine")',
  '- Аккорд через stack: stack(note("c4"), note("e4"), note("g4")).s("sawtooth")',
  '- Аккорд через n: n("[c4,e4,g4]").s("sawtooth")  ← ПРАВИЛЬНО для аккорда!',
  '- Арпеджированный аккорд: n("<[c4,e4,g4] [a4,c5,e5]>").s("sawtooth")',
  '- Паттерн с тишиной: n("<c4 ~ ~ g4 ~ ~>").s("sine")',
  '- Последовательность: sequence(note("c4"), note("e4"), note("g4"))',
  '- Многослойная композиция: stack(n("0 ~ 2 ~ 4").s("sawtooth"), n("0 ~ 4 ~ 2").s("triangle"))',
  '- С фильтром: n("0 2 4 5 7 9 11").s("sawtooth").lpf(800).gain(0.3)',
  '- С reverb: n("0 ~ 2 ~ 4").s("sine").rev(0.3)',
  '',
  'НЕПРАВИЛЬНЫЙ синтаксис (НЕ ПИШИ ТАК):',
  '- ❌ note("<c4 e4 g4>") — note() не поддерживает mini-notation',
  '- ❌ note("[c4,e4,g4]") — note() не поддерживает аккорды',
  '- ❌ note("[c4,e4,g4] [a4,c5,e5]") — note() не поддерживает последовательности',
  '- ❌ note("~ g3 ~ g3 ~ b3") — note() не поддерживает паттерны с тишиной',
  '- ДЛЯ ВСЕГО ЭТОГО ИСПОЛЬЗУЙ n()!',
  '',
  'ПРАВИЛА ВЫВОДА:',
  '1. Верни ТОЛЬКО JS-код паттерна.',
  '2. Без markdown-блоков.',
  '3. Без пояснений и преамбул ("Here is the updated score:").',
  '4. Без блоков<think></think>.',
  '5. Используй встроенные синтезаторы. Без drum-сэмплов.',
  '6. Для аккордов и паттернов с тишиной — используй n() с mini-notation, НЕ note().',
  '7. note() только для одной статичной ноты.',
  '8. Для нескольких параллельных паттернов — stack(p1, p2, ...).',
  '9. Для последовательного воспроизведения — sequence(...) или cat(...).',
].join('\n');

/**
 * Собирает user prompt с текущим score и инструкцией.
 */
export const buildUserPrompt = (currentScore: string, instruction: string): string =>
  `ТЕКУЩИЙ SCORE:\n\`\`\`\n${currentScore}\n\`\`\`\n\nИНСТРУКЦИЯ ПОЛЬЗОВАТЕЛЯ:\n${instruction}\n\nВерни новый score (только JS-код, без markdown):`;

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