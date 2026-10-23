/**
 * DisclaimerGate — the blocking legal gate shown until the terms are
 * accepted.
 *
 * Supersedes `DisclaimerBanner` (decision `wavecode-disclaimer-banner`),
 * which made the notice a small non-modal strip pinned to the bottom
 * left corner with the text hidden behind a «Подробнее» toggle. That
 * shape failed at its own job: nothing stopped the user from ignoring
 * it, the «Принять» button was two clicks deep, and the onboarding tour
 * came up underneath it at the same time. Now the notice is a
 * full-viewport overlay — `role="dialog"`, `aria-modal`, scrim,
 * expanded from the first frame — and the app behind it is `inert`
 * (wired in `App.tsx`) until the checkbox is ticked and «Принять»
 * pressed. See `decisions/wavecode-disclaimer-gate.yaml`.
 *
 * Consent model — versioned, persisted, wrap-plus-explicit:
 *   • acceptance is written to `localStorage` under `wavecodeTermsAccepted`
 *     as the bare version string, so bumping `DISCLAIMER_VERSION`
 *     re-prompts everyone who accepted the previous wording;
 *   • the gate never shows again for someone who accepted this version;
 *   • it stays reachable afterwards via the landing footer, which
 *     dispatches `TERMS_OPEN_EVENT` and re-opens it read-only (no
 *     consent controls, a close button instead).
 *
 * Legal wording is mirrored in the legal KB template
 * `1_projects/05_wavecode/04_templates/01_site-disclaimer.md` (ЮрОтдел).
 * Any edit here MUST land there in the same commit AND bump
 * `DISCLAIMER_VERSION` — the gate is the only place these clauses are
 * shown to users.
 */

import { createEffect, createSignal, onCleanup, onMount, Show, type JSX } from 'solid-js';
import {
  DISCLAIMER_VERSION,
  type ConsentGate,
} from '~/presentation/state/consentGate';

export type DisclaimerGateProps = {
  readonly gate: ConsentGate;
};

export function DisclaimerGate(props: DisclaimerGateProps): JSX.Element {
  const [consented, setConsented] = createSignal(false);
  let panel: HTMLDivElement | undefined;

  // Pull focus onto the dialog so Tab cannot wander into the inert app
  // behind it, and so the gate is announced instead of the page under it.
  createEffect(() => {
    if (props.gate.visible()) panel?.focus();
  });

  onMount(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      // Esc closes the read-only re-open only. A pending gate has no
      // dismiss path — that is the whole point of it.
      if (e.key !== 'Escape' || !props.gate.readOnly()) return;
      props.gate.close();
    };
    window.addEventListener('keydown', onKeyDown);
    onCleanup(() => window.removeEventListener('keydown', onKeyDown));
  });

  const accept = (): void => {
    props.gate.accept();
    setConsented(false);
  };

  return (
    <Show when={props.gate.visible()}>
      <div
        class="disclaimer-gate"
        data-testid="disclaimer-gate"
        data-version={DISCLAIMER_VERSION}
        data-mode={props.gate.pending() ? 'pending' : 'read-only'}
      >
        <div
          class="disclaimer-gate__panel"
          data-testid="disclaimer-panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby="disclaimer-title"
          aria-describedby="disclaimer-summary"
          tabIndex={-1}
          ref={panel}
        >
          <div class="disclaimer-gate__head">
            <h2 id="disclaimer-title" class="disclaimer-gate__title">
              Условия использования wavecode
            </h2>
            <Show when={props.gate.readOnly()}>
              <button
                type="button"
                class="disclaimer-gate__close"
                data-testid="disclaimer-close"
                aria-label="Закрыть условия использования"
                onClick={() => props.gate.close()}
              >
                ×
              </button>
            </Show>
          </div>

          <p
            class="disclaimer-gate__summary"
            data-testid="disclaimer-summary"
          >
            Сервис предоставляется на условиях простой (неисключительной)
            безвозмездной лицензии. Ознакомьтесь с условиями, продолжив
            использование.
          </p>

          <div class="disclaimer-gate__body" data-testid="disclaimer-body">
            <section class="disclaimer-section">
              <h3 class="disclaimer-section__title">
                1. Право пользования ПО и интерфейсом
              </h3>
              <p class="disclaimer-section__text">
                wavecode — браузерное веб-приложение (далее — Сервис).
                Сервис предоставляется вам на условиях простой
                (неисключительной) безвозмездной лицензии (ст. 1235 ГК РФ)
                на использование программного обеспечения и интерфейса по
                их прямому назначению. Исходный код распространяется по
                открытой лицензии Apache License 2.0 (ст. 1286.1 ГК РФ).
                Запуск Сервиса в браузере — правомерное воспроизведение
                программы для запуска в памяти устройства (ст. 1280 п. 1
                ГК РФ). Срок действия лицензии — период вашего доступа к
                Сервису.
              </p>
            </section>

            <section class="disclaimer-section">
              <h3 class="disclaimer-section__title">
                2. Интеллектуальная собственность и лицензия
              </h3>
              <p class="disclaimer-section__text">
                Исключительные права на исходный код, элементы оформления и
                наименование «wavecode» принадлежат правообладателю — Петру
                Косову и участникам проекта (см. файл NOTICE в репозитории)
                — и (или) третьим лицам на основании их лицензий.
              </p>
              <p class="disclaimer-section__text">
                Настоящие условия не являются договором отчуждения
                исключительного права (ст. 1229, 1234 ГК РФ) и не
                предоставляют исключительную лицензию (ст. 1236 ГК РФ):
                вам предоставляется только право пользования. Использование
                наименования и товарных знаков в качестве собственных
                обозначений не допускается. Использование элементов Сервиса
                за пределами этих Условий возможно только в пределах,
                разрешённых Apache License 2.0, — включая право на
                модификацию и распространение производных работ при
                сохранении уведомлений об авторском праве.
              </p>
            </section>

            <section class="disclaimer-section">
              <h3 class="disclaimer-section__title">3. Ваши материалы</h3>
              <p class="disclaimer-section__text">
                Права на созданные вами композиции (score) и аудиозаписи
                принадлежат вам (ст. 1259 ГК РФ). Материалы хранятся
                локально в вашем браузере и не передаются на наш сервер.
                Встроенные элементы (например, сэмплы) распространяются по
                CC0 1.0 — см. LICENSE.txt в каталоге сэмплов.
              </p>
            </section>

            <section class="disclaimer-section">
              <h3 class="disclaimer-section__title">
                4. Данные и конфиденциальность
              </h3>
              <p class="disclaimer-section__text">
                Файлы cookie не используются. Настройки, score и история
                сообщений хранятся локально в браузере (localStorage,
                IndexedDB). При использовании AI-ассистента текст запроса
                отправляется на прокси llm.kosov.online и далее провайдеру
                модели; обработка таких запросов регулируется политиками
                этих сервисов.
              </p>
            </section>

            <p class="disclaimer-gate__note">
              Полный текст лицензии на исходный код —{' '}
              <a
                href="https://github.com/11111000000/wavecode/blob/master/LICENSE"
                target="_blank"
                rel="noopener noreferrer"
              >
                Apache License 2.0
              </a>
              .
            </p>
          </div>

          <Show when={props.gate.pending()}>
            <p class="disclaimer-gate__hint" data-testid="disclaimer-hint">
              Приложение откроется после того, как вы примете условия.
              Галочка и кнопка «Принять» сохраняют выбор в этом браузере —
              в следующий раз окно не появится.
            </p>

            <label class="disclaimer-consent">
              <input
                type="checkbox"
                class="disclaimer-consent__checkbox"
                data-testid="disclaimer-consent"
                checked={consented()}
                onChange={(e) => setConsented(e.currentTarget.checked)}
              />
              <span class="disclaimer-consent__label">
                Я принимаю Условия использования
              </span>
            </label>

            <div class="disclaimer-gate__actions">
              <button
                type="button"
                class="disclaimer-btn disclaimer-btn--primary"
                data-testid="disclaimer-accept"
                disabled={!consented()}
                onClick={accept}
              >
                Принять
              </button>
            </div>
          </Show>
        </div>
      </div>
    </Show>
  );
}