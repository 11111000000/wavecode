/**
 * DisclaimerBanner — floating (non-modal) legal banner for the site.
 *
 * Replaces the blocking `DisclaimerModal` (see decision
 * `wavecode-disclaimer-banner`): the modal covered the whole editor
 * with a dark overlay and re-appeared on every entry, which made a
 * legal notice feel like an outage. The banner floats bottom-left,
 * leaves the transport bar and the voice-FAB cluster alone, and stays
 * out of the way until the visitor expands it.
 *
 * Consent model — versioned, persisted, wrap-plus-explicit:
 *   • acceptance is written to `localStorage` under `wavecodeTermsAccepted`
 *     as the bare version string, so bumping `DISCLAIMER_VERSION`
 *     re-prompts everyone who accepted the previous wording;
 *   • the banner hides once the current version is accepted;
 *   • it stays reachable afterwards via the landing footer, which
 *     dispatches `TERMS_OPEN_EVENT` and re-opens the banner read-only
 *     (no accept button, a close button instead).
 *
 * Legal wording is mirrored in the legal KB template
 * `1_projects/05_wavecode/04_templates/01_site-disclaimer.md` (ЮрОтдел).
 * Any edit here MUST land there in the same commit — the banner is the
 * only place these clauses are shown to users.
 */

import { createSignal, onCleanup, onMount, Show, type JSX } from 'solid-js';

/**
 * Bump when the wording changes: every stored acceptance of an older
 * version stops matching and the banner shows up again.
 */
export const DISCLAIMER_VERSION = 'v1';

const STORAGE_KEY = 'wavecodeTermsAccepted';

/** Fired by the landing footer to re-open the banner after acceptance. */
export const TERMS_OPEN_EVENT = 'wavecode:open-terms';

export const openTermsBanner = (): void => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(TERMS_OPEN_EVENT));
};

const readAccepted = (): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Private-mode / disabled storage — treat as "not accepted yet".
    return null;
  }
};

const writeAccepted = (version: string): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(STORAGE_KEY, version);
    return true;
  } catch {
    return false;
  }
};

export function DisclaimerBanner(): JSX.Element {
  const [accepted, setAccepted] = createSignal(readAccepted());
  const [forcedOpen, setForcedOpen] = createSignal(false);
  const [expanded, setExpanded] = createSignal(false);
  const [consented, setConsented] = createSignal(false);

  const isAccepted = (): boolean => accepted() === DISCLAIMER_VERSION;

  /** Visible until accepted; afterwards only when re-opened from the footer. */
  const visible = (): boolean => !isAccepted() || forcedOpen();

  onMount(() => {
    const onOpen = (): void => {
      setForcedOpen(true);
      setExpanded(true);
    };
    window.addEventListener(TERMS_OPEN_EVENT, onOpen);
    onCleanup(() => window.removeEventListener(TERMS_OPEN_EVENT, onOpen));
  });

  const accept = (): void => {
    setAccepted(writeAccepted(DISCLAIMER_VERSION) ? DISCLAIMER_VERSION : null);
    setForcedOpen(false);
    setExpanded(false);
    setConsented(false);
  };

  const close = (): void => {
    setForcedOpen(false);
    setExpanded(false);
    setConsented(false);
  };

  return (
    <Show when={visible()}>
      <aside
        class="disclaimer-banner"
        classList={{ 'disclaimer-banner--expanded': expanded() }}
        data-testid="disclaimer-banner"
        data-version={DISCLAIMER_VERSION}
        role="region"
        aria-labelledby="disclaimer-title"
      >
        <div class="disclaimer-banner__head">
          <h2 id="disclaimer-title" class="disclaimer-banner__title">
            Условия использования wavecode
          </h2>
          <div class="disclaimer-banner__head-actions">
            <button
              type="button"
              class="disclaimer-banner__toggle"
              data-testid="disclaimer-expand"
              aria-expanded={expanded()}
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded() ? 'Свернуть' : 'Подробнее'}
            </button>
            <Show when={isAccepted()}>
              <button
                type="button"
                class="disclaimer-banner__close"
                data-testid="disclaimer-close"
                aria-label="Закрыть условия использования"
                onClick={close}
              >
                ×
              </button>
            </Show>
          </div>
        </div>

        <p
          class="disclaimer-banner__summary"
          data-testid="disclaimer-summary"
        >
          Сервис предоставляется на условиях простой (неисключительной)
          безвозмездной лицензии. Ознакомьтесь с условиями, продолжив
          использование.
        </p>

        <Show when={expanded()}>
          <div class="disclaimer-banner__body" data-testid="disclaimer-body">
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

            <p class="disclaimer-banner__note">
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

          <Show when={!isAccepted()}>
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

            <div class="disclaimer-banner__actions">
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
        </Show>
      </aside>
    </Show>
  );
}
