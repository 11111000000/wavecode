import { Effect, Layer, type Context } from 'effect';
import { LLMClient, type CompletionRequest, type CompletionChunk } from '~/domain/services';

/**
 * Live LLM client — raw fetch к llm.kosov.online (LiteLLM proxy, OpenAI-compatible).
 *
 * Models (через llm-proxy, 2026-10-26 → DeepSeek direct):
 *   - "smart" → deepseek-v4-pro   (глубже, но всё равно быстро без reasoning)
 *   - "fast"  → deepseek-flash    (быстрый, reasoning почти не тратит)
 *
 * Streaming: chat/completions called with `stream: true` returns
 * Server-Sent Events. We parse each `data: {...}` line and emit a
 * `CompletionChunk` per `delta.content` (or `delta.reasoning_content`).
 * Chunks are pushed into the returned `ReadableStream` as soon as they
 * arrive — no buffering until the full body is read. If the proxy
 * ever returns a buffered JSON response (some LiteLLM builds do),
 * we fall back to the legacy JSON path and synthesize one big chunk.
 *
 * ── Почему reasoning_effort решает всё ──────────────────────────────────
 *
 * Reasoning-модель тратит время на скрытое «размышление» ДО первого
 * токена ответа. Клиент эти токены выбрасывает (`delta.reasoning_content`
 * не enqueue-ится), поэтому пользователь видит пустой экран ровно
 * столько, сколько модель думала. Замеры 2026-11-02 через
 * llm.kosov.online (системный prompt wavecode + правка одного паттерна):
 *
 *   effort=high → первый токен 7.4-11.2 с, reasoning 1400-2500 симв.
 *   effort=low  → первый токен 4.6-10.3 с, reasoning  700-1800 симв.
 *   effort=none → первый токен 1.0-1.4 с, reasoning     0 симв.  ← 3/3
 *
 * `none` — единственный уровень, который DeepSeek реально отключает
 * (в отличие от `off`/`minimal`, которые он игнорирует). Именно он
 * стоит по умолчанию: score-правка не требует рассуждений, а
 * пользователь не должен ждать пустого экрана.
 */

type Model = 'smart' | 'fast';

/**
 * Which upstream the proxy currently routes to.
 *
 * The client cannot stay provider-agnostic in the request body: the
 * way reasoning is controlled differs per provider, and LiteLLM (which
 * sits in front of both) silently drops provider-specific top-level
 * fields — only `extra_body` is passed through to the provider.
 *
 *   deepseek — `extra_body.reasoning_effort` (none|low|high). `none`
 *              отключает reasoning полностью (замер 2026-11-02: 0
 *              символов reasoning, 1.1 с до первого токена); `off`
 *              и `minimal` провайдер ИГНОРИРУЕТ — на них reasoning
 *              даже растёт. Поэтому клиентский 'off' → 'none'.
 *   minimax  — `extra_body.thinking.type = 'disabled'` (MiniMax-native
 *              способ выключить reasoning).
 */
type Upstream = 'deepseek' | 'minimax';

/**
 * Уровень reasoning, который уходит провайдеру.
 *
 * `none` — reasoning выключен. `low`/`high` — размышление включено,
 * время до первого токена ответа растёт в разы (см. замеры в шапке).
 */
type Effort = 'none' | 'low' | 'high';

/**
 * Жёсткий потолок на ожидание заголовков ответа.
 *
 * Раньше fetch шёл без `signal` и без таймаута: зависший upstream
 * висел бесконечно, а «отмена» голосового запроса (barge-in)
 * прерывала только Effect-волокно — HTTP-запрос продолжал жить.
 */
const REQUEST_TIMEOUT_MS = 45_000;

/**
 * Потолок на «тишину» в теле SSE-потока: если модель начала ответ и
 * замолчала, мы не должны висеть вечно.
 */
const STREAM_IDLE_TIMEOUT_MS = 30_000;

type LiveLLMClientDeps = {
  readonly apiUrl: string;
  readonly apiKey: string;
  readonly defaultModel: Model;
  readonly defaultThinking: 'low' | 'high' | 'off';
  readonly upstream: Upstream;
};

const make = (deps: LiveLLMClientDeps): Context.Tag.Service<typeof LLMClient> => ({
  streamCompletion: (req: CompletionRequest) =>
    Effect.gen(function* () {
      const modelName = req.model ?? deps.defaultModel;
      const messages = [
        ...(req.systemPrompt ? [{ role: 'system' as const, content: req.systemPrompt }] : []),
        ...req.messages.map((m) => ({ role: m.role, content: m.content })),
      ];

      // Уровень размышления: 'off' = размышления нет (самый быстрый
      // путь), 'low'/'high' = модель сначала думает.
      const thinking: 'low' | 'high' | 'off' = req.thinking ?? deps.defaultThinking;

      // max_tokens: 4000 (было 2000). Upstream — reasoning-модель: при
      // effort=high (дефолт провайдера) размышление съедает весь бюджет,
      // ответ приходит с finish_reason="length" и content="" (см. ADR
      // wavecode-deepseek-upstream-adaptation). 4000 = запас под reasoning
      // плюс сам ответ; при effort=low через extra_body reasoning занимает
      // ~130 токенов, так что запас многократный.
      const requestBody: Record<string, unknown> = {
        model: modelName,
        messages,
        stream: true,
        temperature: 0.3,
        max_tokens: 4000,
      };

      // effort, который реально поедет провайдеру.
      let effort: Effort = 'none';
      if (deps.upstream === 'deepseek') {
        // reasoning_effort уходит в extra_body, а НЕ top-level: у прокси
        // глобальный litellm_settings.drop_params=true, и LiteLLM молча
        // выкидывает provider-специфичные поля верхнего уровня.
        // Замер 2026-10-26 через llm.kosov.online (model=fast):
        //   top-level reasoning_effort=low → 1221 completion-токенов, 7.9 s
        //   extra_body.reasoning_effort=low → 125 токенов, 1.8 s
        // extra_body проходит насквозь — это единственная форма, которая
        // реально доезжает до провайдера.
        //
        // 'off' → 'none': DeepSeek игнорирует off/minimal (замер
        // 2026-10-26), но 'none' РЕАЛЬНО выключает reasoning (замер
        // 2026-11-02, 3/3 прогона: 0 символов reasoning, первый токен
        // через 1.0-1.4 с против 4.6-12.1 с у low/high).
        effort = thinking === 'high' ? 'high' : thinking === 'low' ? 'low' : 'none';
        requestBody.extra_body = { reasoning_effort: effort };
      } else {
        // MiniMax-профиль: reasoning отключается полем thinking.type.
        effort = thinking === 'high' ? 'high' : thinking === 'low' ? 'low' : 'none';
        if (thinking !== 'off') {
          requestBody.reasoning_effort = thinking === 'high' ? 'high' : 'low';
        }
        if (thinking === 'off') {
          requestBody.extra_body = { thinking: { type: 'disabled' } };
        }
      }

      // Ключ диск-кэша LiteLLM НЕ включает extra_body (замер 2026-11-02:
      // запрос с effort=low, затем с effort=none по тому же промпту →
      // второй вернул кэш за 0.02 с, т.е. отдал ответ, посчитанный с
      // ДРУГИМ уровнем размышления). `user` в ключ входит (проверено тем
      // же замером: смена user → cache miss). Кодируем уровень в `user`,
      // чтобы у каждого уровня была своя запись кэша, а одинаковые
      // запросы по-прежнему кэшировались.
      requestBody.user = `wavecode-effort-${effort}`;

      console.log('[llm] → request (stream)', {
        model: modelName,
        messages: messages.length,
        upstream: deps.upstream,
        thinking,
        effort,
        extra_body: requestBody.extra_body,
        reasoning_effort: requestBody.reasoning_effort,
      });

      // Таймаут + прерывание: fetch обязан умирать вместе с Effect-волокном,
      // иначе «отмена» голосового запроса оставляла HTTP-запрос жить.
      const abortController = new AbortController();
      let timedOut = false;
      const timeoutHandle = setTimeout(() => {
        timedOut = true;
        abortController.abort();
      }, REQUEST_TIMEOUT_MS);

      const response = yield* Effect.tryPromise({
        try: () =>
          fetch(`${deps.apiUrl}/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${deps.apiKey}`,
            },
            body: JSON.stringify(requestBody),
            signal: abortController.signal,
          }),
        catch: (err) =>
          timedOut
            ? new Error(
              `LLM не ответил за ${REQUEST_TIMEOUT_MS / 1000} с ` +
                `(${modelName}, effort=${effort}). Проверь прокси llm.kosov.online.`,
            )
            : classifyLLMTransportError(err, deps.apiUrl),
      }).pipe(
        Effect.onInterrupt(() =>
          Effect.sync(() => {
            abortController.abort();
          }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            clearTimeout(timeoutHandle);
          }),
        ),
      );

      if (!response.ok) {
        const text = yield* Effect.tryPromise({
          try: () => response.text(),
          catch: () => '',
        }).pipe(Effect.catchAll(() => Effect.succeed('')));
        const errMsg = classifyLLMHttpError(response.status, text);
        console.error('[llm] ✗ HTTP error', errMsg);
        return yield* Effect.fail(new Error(errMsg));
      }
      if (!response.body) {
        const errMsg = 'LLM response has no body';
        console.error('[llm] ✗ no body');
        return yield* Effect.fail(new Error(errMsg));
      }

      // Read the first byte of the response to detect SSE-vs-JSON shape.
      // LiteLLM with `stream: true` returns `text/event-stream`; with
      // `stream: false` returns `application/json`. Some deployments
      // ignore `stream` and return JSON either way — we sniff the first
      // chunk's leading character ('{' → JSON, 'd' → SSE) and route.
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const { value: firstChunk } = yield* Effect.tryPromise(() => reader.read());
      if (!firstChunk) {
        return yield* Effect.fail(new Error('LLM stream produced no bytes'));
      }
      const head = decoder.decode(firstChunk, { stream: false });
      const trimmedHead = head.trimStart();
      if (trimmedHead.startsWith('{')) {
        // Buffered JSON — fall back to legacy parse path.
        let buffer = head;
        while (true) {
          const next = yield* Effect.tryPromise(() => reader.read());
          if (next.done) break;
          if (next.value) buffer += decoder.decode(next.value, { stream: true });
        }
        buffer += decoder.decode();
        const fallback = synthesizeSingleChunkStream(buffer);
        if (fallback instanceof Error) {
          return yield* Effect.fail(fallback);
        }
        return fallback;
      }

      // SSE path — first chunk may already contain one or more lines.
      // Wrap the remaining reader + carryover into a controller-driven
      // ReadableStream that emits CompletionChunk per `delta`.
      const stream = new ReadableStream<CompletionChunk>({
        start(controller) {
          let buffer = head;
          let closed = false;
          let emittedText = false;
          let reasoningChars = 0;
          let finishReason: string | null = null;
          const closeOnce = (): void => {
            if (closed) return;
            closed = true;
            try {
              controller.close();
            } catch {
              /* already closed */
            }
          };
          const failOnce = (err: Error): void => {
            if (closed) return;
            closed = true;
            try {
              controller.error(err);
            } catch {
              /* already errored */
            }
          };
          const consume = (line: string): void => {
            const outcome = consumeSseLine(line, controller);
            emittedText = emittedText || outcome.textEmitted;
            reasoningChars += outcome.reasoningChars;
            if (outcome.finishReason) finishReason = outcome.finishReason;
          };
          // Сторож тишины: модель могла начать ответ и зависнуть. Без
          // него «молчащий» SSE держит UI в состоянии «стриминг» вечно.
          let idleTimer: ReturnType<typeof setTimeout> | null = null;
          const clearIdleTimer = (): void => {
            if (idleTimer === null) return;
            clearTimeout(idleTimer);
            idleTimer = null;
          };
          const armIdleTimer = (): void => {
            clearIdleTimer();
            idleTimer = setTimeout(() => {
              failOnce(
                new Error(
                  `LLM замолчал на ${STREAM_IDLE_TIMEOUT_MS / 1000} с ` +
                    'после начала ответа (SSE-поток прерван).',
                ),
              );
            }, STREAM_IDLE_TIMEOUT_MS);
          };
          const pump = async (): Promise<void> => {
            try {
              armIdleTimer();
              while (true) {
                const next = await reader.read();
                if (next.done) break;
                armIdleTimer();
                if (next.value) buffer += decoder.decode(next.value, { stream: true });
                let nlIdx = buffer.indexOf('\n');
                while (nlIdx !== -1) {
                  const line = buffer.slice(0, nlIdx).replace(/\r$/, '');
                  buffer = buffer.slice(nlIdx + 1);
                  consume(line);
                  nlIdx = buffer.indexOf('\n');
                }
              }
              clearIdleTimer();
              buffer += decoder.decode();
              if (buffer.trim()) {
                consume(buffer);
                buffer = '';
              }
              // Reasoning-модель может израсходовать весь лимит токенов на
              // размышления и не отдать ни символа ответа. Раньше такой
              // ответ доходил до UI как «пустой ответ» без причины.
              if (!emittedText) {
                failOnce(
                  new Error(
                    finishReason === 'length'
                      ? `LLM вернул пустой ответ: лимит токенов исчерпан на размышления ` +
                        `(finish_reason=length, reasoning ${reasoningChars} симв.). ` +
                        'Уменьши глубину размышления или подними max_tokens.'
                      : `LLM вернул пустой ответ (нет текста, reasoning ${reasoningChars} симв.).`,
                  ),
                );
                return;
              }
              closeOnce();
            } catch (err) {
              failOnce(err instanceof Error ? err : new Error(String(err)));
            } finally {
              clearIdleTimer();
              try {
                await reader.cancel();
              } catch {
                /* ignore */
              }
            }
          };
          // Kick off pump; do not await — ReadableStream `start` is sync.
          void pump();
        },
        cancel() {
          // Reader is cancelled by pump()'s finally; nothing else to do.
        },
      });

      return stream;
    }),
});

/**
 * Dispatch one SSE line. Empty lines and non-`data:` prefixes are
 * skipped (SSE protocol). `[DONE]` closes the stream (we close from
 * the outer pump; just no-op here). Each `data: {...}` JSON object
 * may carry `choices[].delta.content` (text) or
 * `choices[].delta.reasoning_content` (reasoning trace).
 *
 * We do NOT enqueue reasoning content to the chunk stream — the
 * `cleanLLMResponse` step in `applyEdit` strips it, and exposing it
 * would confuse the UI transcript. Reasoning content is logged to
 * the console for debugging.
 *
 * The returned outcome tells the caller what the line contributed:
 * whether visible text was emitted, how many reasoning characters it
 * carried, and the provider's `finish_reason` (the latter arrives in
 * the last chunk of a stream and tells us whether the model ran out
 * of token budget).
 */
type SseLineOutcome = {
  readonly textEmitted: boolean;
  readonly reasoningChars: number;
  readonly finishReason: string | null;
};

const consumeSseLine = (
  line: string,
  controller: ReadableStreamDefaultController<CompletionChunk>,
): SseLineOutcome => {
  const idle: SseLineOutcome = { textEmitted: false, reasoningChars: 0, finishReason: null };
  if (!line) return idle;
  const trimmed = line.trim();
  if (!trimmed.startsWith('data:')) return idle;
  const payload = trimmed.slice(5).trim();
  if (payload === '[DONE]') return idle;
  let parsed: {
    choices?: {
      delta?: { content?: string; reasoning_content?: string };
      finish_reason?: string | null;
    }[];
    error?: { message?: string };
  };
  try {
    parsed = JSON.parse(payload) as typeof parsed;
  } catch {
    return idle;
  }
  if (parsed.error?.message) {
    try {
      controller.error(new Error(`LLM stream error: ${parsed.error.message}`));
    } catch {
      /* already errored */
    }
    return idle;
  }
  const choice = parsed.choices?.[0];
  const delta = choice?.delta;
  let textEmitted = false;
  if (delta?.content) {
    controller.enqueue({ type: 'text', delta: delta.content });
    textEmitted = true;
  }
  const reasoningChars = delta?.reasoning_content?.length ?? 0;
  if (delta?.reasoning_content) {
    console.log('[llm] … reasoning', delta?.reasoning_content.length, 'chars so far');
  }
  return {
    textEmitted,
    reasoningChars,
    finishReason: choice?.finish_reason ?? null,
  };
};

/**
 * Fallback for non-streaming responses. Parses the buffered JSON
 * (or stitched-together SSE) and synthesizes a single chunk stream
 * containing the full message content. Returns an `Error` if the
 * body cannot be parsed or the message is empty.
 */
const synthesizeSingleChunkStream = (
  buffer: string,
): ReadableStream<CompletionChunk> | Error => {
  if (!buffer.trim()) {
    return new Error('LLM returned empty body (no chunks)');
  }
  let content = '';
  let reasoningContent = '';
  let finishReason: string | null = null;
  try {
    const parsed = JSON.parse(buffer) as {
      choices?: {
        message?: { content?: string; reasoning_content?: string };
        finish_reason?: string | null;
      }[];
      error?: { message?: string };
    };
    if (parsed.error) {
      return new Error(`LLM API error: ${parsed.error.message ?? JSON.stringify(parsed.error)}`);
    }
    content = parsed.choices?.[0]?.message?.content ?? '';
    reasoningContent = parsed.choices?.[0]?.message?.reasoning_content ?? '';
    finishReason = parsed.choices?.[0]?.finish_reason ?? null;
  } catch {
    const sseContent: string[] = [];
    for (const line of buffer.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (data === '[DONE]' || !data) continue;
      try {
        const parsed = JSON.parse(data) as {
          choices?: { delta?: { content?: string }; finish_reason?: string | null }[];
        };
        const choice = parsed.choices?.[0];
        const delta = choice?.delta?.content;
        if (delta) sseContent.push(delta);
        if (choice?.finish_reason) finishReason = choice.finish_reason;
      } catch {
        // skip malformed line
      }
    }
    content = sseContent.join('');
  }
  if (!content) {
    // Reasoning-модель может потратить весь лимит токенов на размышления и
    // не отдать ни символа ответа. Раньше это доезжало до UI как безликое
    // «пустой ответ» — теперь различаем «кончился бюджет» и «просто нет текста».
    if (finishReason === 'length') {
      return new Error(
        `LLM вернул пустой ответ: лимит токенов исчерпан на размышления ` +
          `(finish_reason=length, reasoning ${reasoningContent.length} симв.). ` +
          'Уменьши глубину размышления или подними max_tokens.',
      );
    }
    const hint = reasoningContent
      ? ` (reasoning ${reasoningContent.length} симв. — ответ не сформирован)`
      : '';
    return new Error(`LLM вернул пустой ответ (нет текста в теле ответа)${hint}`);
  }
  return new ReadableStream<CompletionChunk>({
    start(controller) {
      controller.enqueue({ type: 'text', delta: content });
      controller.close();
    },
  });
};

/**
 * Translate an HTTP error response from LiteLLM into a single actionable
 * message. We special-case the failure modes we know about so the UI can
 * give a useful hint instead of a raw 400 JSON dump.
 *
 * - 400 {"error":{"type":"no_db_connection",...}} → the bundle's
 *   VITE_LLM_PROXY_KEY does not match LITELLM_MASTER_KEY on angara-1
 *   (or the proxy is starting up and both master_key and DB are unset).
 *   We surface this explicitly because it is silent: the SPA builds
 *   and deploys, the request reaches the proxy, but auth fails because
 *   the key is wrong. See decisions/wavecode-llm-public-auth-key-mismatch.yaml
 *   for the post-mortem.
 * - 401 "Malformed API Key" → key doesn't start with "sk-" (rare; we
 *   already log a warning at boot in this case).
 * - 401 "Authentication Error" → key rejected (rotated? wrong?).
 * - 429 → NOT our rate limit: LiteLLM relays the upstream provider's
 *   429 verbatim. The body carries the real reason — either an exhausted
 *   provider plan/balance ("Token Plan usage limit reached", "Insufficient
 *   Balance"), where retrying cannot help, or a genuine transient rate
 *   limit. We used to flatten both into "rate-limited by proxy. Подожди
 *   и retry.", which sent the 2026-10-26 diagnosis (MiniMax Token Plan
 *   exhausted) down a dead end: the operator was told to wait for a limit
 *   that was never ours. The reason now travels with the error.
 * - 503 {"error":"auth_not_ready"} → our fail-closed patch on the
 *   proxy is doing its job (master_key+DB both unset). The proxy is
 *   starting up; retry.
 * - everything else: include the raw body (truncated) so the user can
 *   see the upstream error.
 */
const classifyLLMHttpError = (status: number, body: string): string => {
  let parsed: { error?: { type?: string; message?: string; code?: number | string } } = {};
  try {
    parsed = JSON.parse(body) as typeof parsed;
  } catch {
    /* not JSON — fall through to generic */
  }
  const errType = parsed.error?.type;
  const errMsg = parsed.error?.message ?? '';

  if (status === 400 && errType === 'no_db_connection') {
    return (
      `LLM HTTP 400: ${errMsg || 'no_db_connection'}\n` +
      '\n' +
      'Public LiteLLM (llm-proxy-public.service) отклонил ключ: api_key != master_key, ' +
      'поэтому LiteLLM ищет virtual key в Prisma DB, но Prisma отключён в ' +
      'services/llm-proxy.nix (Prisma не работает в Nix store).\n' +
      '\n' +
      'В bundle (ui/.env.local) лежит ключ, который НЕ совпадает с ' +
      'LITELLM_MASTER_KEY на angara-1. Скопируй значение с сервера и обнови .env.local:\n' +
      '  sudo grep ^LITELLM_MASTER_KEY /etc/secrets/llm-proxy/master.key\n' +
      '  cp ui/.env.example ui/.env.local   # if missing\n' +
      '  $EDITOR ui/.env.local             # paste the value, include the sk-litellm- prefix\n' +
      '  ./bin/deploy.sh\n' +
      '\n' +
      'bin/check-llm-key.sh (запускается из deploy.sh) теперь ловит эту ситуацию ДО pnpm build.'
    );
  }

  if (status === 503 && errType === undefined && /auth_not_ready/.test(body)) {
    return (
      `LLM HTTP 503: proxy is starting up (auth_not_ready)\n` +
      '\n' +
      'LiteLLM public instance временно без auth backend (master_key и DB оба не сконфигурены — ' +
      'это бывает во время config reload). Прокси fail-closed возвращает 503 вместо того, ' +
      'чтобы пускать всех как PROXY_ADMIN. Подожди 5-10 секунд и retry.'
    );
  }

  if (status === 401) {
    if (/malformed/i.test(errMsg) || /malformed/i.test(body)) {
      return (
        `LLM HTTP 401: Malformed API Key. Ключ должен начинаться с 'sk-' ` +
        `(например, 'sk-litellm-...'). Проверь ui/.env.local VITE_LLM_PROXY_KEY.`
      );
    }
    return (
      `LLM HTTP 401: Authentication Error. Ключ отклонён прокси. ` +
      `Возможно, LITELLM_MASTER_KEY на angara-1 был rotated. ` +
      `Проверь bin/check-llm-key.sh.`
    );
  }

  if (status === 429) {
    // Тело ответа — это ответ upstream-провайдера, проброшенный LiteLLM
    // без изменений. Причина в нём, а не в нашем rate limit.
    const detail = (errMsg || body).replace(/\s+/g, ' ').trim().slice(0, 300);
    if (/token plan|insufficient balance|quota|credit|purchase|plan usage limit/i.test(detail)) {
      return (
        `LLM HTTP 429: исчерпан лимит/баланс upstream-провайдера — это НЕ rate limit прокси.\n` +
        `Причина от провайдера: ${detail}\n` +
        '\n' +
        'Повтор не поможет: нужен другой upstream или пополнение баланса.\n' +
        'Диагностика: sudo journalctl -u llm-proxy-public -u llm-proxy -n 100 --no-pager | ' +
        'grep -E "RateLimitError|Token Plan|Insufficient"'
      );
    }
    return (
      `LLM HTTP 429: rate limit от провайдера: ${detail}\n` +
      '\n' +
      'Подожди и повтори запрос.'
    );
  }

  if (status >= 500) {
    return `LLM HTTP ${status} (upstream/server error): ${errMsg || body.slice(0, 300)}`;
  }

  return `LLM HTTP ${status}: ${body.slice(0, 500)}`;
};

/**
 * Translate the `fetch()` failure into an `Error` whose `message` tells the
 * operator what is wrong without a packet capture.
 *
 * Chromium throws `TypeError: Failed to fetch` for THREE distinct reasons;
 * we can't tell them apart from `err.message` alone, so we list the
 * candidates so the operator can run `curl -X OPTIONS -H 'Origin: …' …`
 * to disambiguate.
 *
 * Non-Chromium browsers throw messages like `NetworkError when attempting
 * to fetch resource.` — same root causes, different surface form.
 */
const classifyLLMTransportError = (err: unknown, apiUrl: string): Error => {
  const rawMsg = err instanceof Error ? err.message : String(err);
  const isFetchFailure = /Failed to fetch|NetworkError|fetch failed|load failed/i.test(rawMsg);
  if (!isFetchFailure) {
    return new Error(`LLM HTTP request failed: ${rawMsg}`);
  }

  const hints: string[] = [];
  try {
    const u = new URL(apiUrl);
    if (
      typeof window !== 'undefined'
      && (window.location.protocol === 'https:' && u.protocol === 'http:'
        || window.location.protocol === 'http:' && u.protocol === 'https:')
    ) {
      hints.push('mixed-content: http/https-protocol mismatch');
    }
    if (typeof window !== 'undefined' && window.location.hostname !== u.hostname) {
      hints.push(`CORS: добавить ${window.location.origin} в proxy.allow_origins`);
    }
  } catch {
    /* apiUrl invalid → leave hints empty */
  }

  return new Error(
    `LLM HTTP request failed: ${rawMsg}${hints.length > 0 ? ` (${hints.join('; ')})` : ''}`,
  );
};

export const makeLiveLLMClient = (
  config: Partial<LiveLLMClientDeps> = {},
): Layer.Layer<LLMClient, never, never> => {
  const apiUrl = config.apiUrl ?? import.meta.env.VITE_LLM_PROXY_URL ?? 'https://llm.kosov.online/v1';
  const apiKey = config.apiKey ?? import.meta.env.VITE_LLM_PROXY_KEY ?? '';
  // `fast` по умолчанию: score-правка не требует глубоких рассуждений,
  // а deepseek-flash без reasoning отвечает за ~1 с (замер 2026-11-02).
  const defaultModel = (config.defaultModel ?? 'fast') as Model;
  // `off` по умолчанию: reasoning выключен → первый токен за ~1 с.
  const defaultThinking = config.defaultThinking ?? 'off';

  // Which provider the proxy routes to. The request body differs (see
  // `Upstream`), so the client must know — otherwise it sends MiniMax-only
  // fields to DeepSeek and vice versa. Env wins over the default; an
  // unknown value is a configuration mistake, not a silent fallback.
  const upstreamRaw: string = config.upstream ?? import.meta.env.VITE_LLM_UPSTREAM ?? 'deepseek';
  const upstream: Upstream = upstreamRaw === 'minimax' ? 'minimax' : 'deepseek';
  if (upstreamRaw !== upstream) {
    console.warn(
      `[llm] VITE_LLM_UPSTREAM='${upstreamRaw}' is unknown — expected ` +
      `'deepseek' or 'minimax'. Falling back to 'deepseek'.`,
    );
  }

  if (!apiKey) {
    console.warn('[llm] VITE_LLM_PROXY_KEY is not set; LLM calls will fail.');
  } else if (!apiKey.startsWith('sk-')) {
    console.warn(
      `[llm] VITE_LLM_PROXY_KEY does not start with 'sk-' — LiteLLM ` +
      `expects the 'sk-litellm-…' format. If you see "Malformed API ` +
      `Key" 401s, prepend 'sk-litellm-' to the key.\n` +
      `Run bin/check-llm-key.sh before pnpm build to catch this at deploy time.`,
    );
  }

  return Layer.succeed(
    LLMClient,
    make({ apiUrl, apiKey, defaultModel, defaultThinking, upstream }) as never,
  );
};