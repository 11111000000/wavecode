/**
 * DisclaimerModal — legal disclaimer + privacy policy consent gate.
 *
 * Mounted at the App level (one line in App.tsx). Shows on every
 * fresh load when the route is `/#/app`, and requires an explicit
 * checkbox consent before the user can continue. Consent is
 * in-memory only — it resets on reload, so the dialog re-appears
 * on every entry (product requirement: «показывать при каждом
 * входе»).
 *
 * No localStorage persistence: the agreement is a per-session
 * acknowledgement, not a durable consent record (there is no
 * backend and no server-side consent storage).
 *
 * Content mirrors the legal KB template
 * `1_projects/05_wavecode/04_templates/01_site-disclaimer.md`
 * (в ЮрОтдел) — see that file for the full Terms and rationale.
 */

import { createSignal, Show, type JSX } from 'solid-js';
import { useHashRoute } from '~/presentation/state/useHashRoute';

export function DisclaimerModal(): JSX.Element {
  const route = useHashRoute();
  const [consented, setConsented] = createSignal(false);
  const [dismissed, setDismissed] = createSignal(false);

  const visible = (): boolean => route() === 'app' && !dismissed();

  return (
    <Show when={visible()}>
      <div
        class="disclaimer-overlay"
        data-testid="disclaimer-overlay"
        role="dialog"
        aria-modal="true"
        aria-labelledby="disclaimer-title"
      >
        <div class="disclaimer-modal">
          <h2 id="disclaimer-title" class="disclaimer-title">
            Условия использования wavecode
          </h2>

          <div class="disclaimer-body">
            <section class="disclaimer-section">
              <h3 class="disclaimer-section__title">1. Право пользования</h3>
              <p class="disclaimer-section__text">
                Сервис wavecode предоставляется вам на условиях простой
                (неисключительной) безвозмездной лицензии. Исходный код
                распространяется по открытой лицензии Apache License 2.0.
                Право использования интерфейса и функций ограничено их
                назначением и действует в период вашего доступа к Сервису.
              </p>
            </section>

            <section class="disclaimer-section">
              <h3 class="disclaimer-section__title">2. Интеллектуальная собственность</h3>
              <p class="disclaimer-section__text">
                Программное обеспечение, интерфейс, элементы дизайна и
                наименования Сервиса принадлежат правообладателю (и иным
                лицам по лицензиям). Эти условия не отчуждают и не передают
                вам исключительных прав — вы получаете только право
                пользования. Воспроизведение, распространение или переработка
                Сервиса вне пределов лицензии не допускается.
              </p>
            </section>

            <section class="disclaimer-section">
              <h3 class="disclaimer-section__title">3. Ваши материалы</h3>
              <p class="disclaimer-section__text">
                Права на созданные вами score и аудиозаписи принадлежат вам;
                Сервис на них не претендует.
              </p>
            </section>

            <section class="disclaimer-section">
              <h3 class="disclaimer-section__title">Политика конфиденциальности</h3>
              <ul class="disclaimer-list">
                <li>Сервис не создаёт учётных записей и не хранит ваши данные на своих серверах.</li>
                <li>
                  Ваш score и история сообщений хранятся локально в вашем браузере
                  (IndexedDB) и не покидают устройство, кроме случаев отправки
                  запроса AI-ассистенту.
                </li>
                <li>Файлы cookie не используются.</li>
                <li>
                  При использовании AI-ассистента текст вашего запроса (score и
                  сообщения) отправляется на LLM-прокси <code>llm.kosov.online</code> и
                  может передаваться провайдеру модели (DeepSeek). Обработка и
                  хранение таких запросов регулируются политиками соответствующих
                  сервисов.
                </li>
              </ul>
            </section>
          </div>

          <label class="disclaimer-consent">
            <input
              type="checkbox"
              class="disclaimer-consent__checkbox"
              data-testid="disclaimer-consent"
              checked={consented()}
              onChange={(e) => setConsented(e.currentTarget.checked)}
            />
            <span class="disclaimer-consent__label">
              Я принимаю Условия использования и Политику конфиденциальности
            </span>
          </label>

          <div class="disclaimer-actions">
            <button
              type="button"
              class="disclaimer-btn disclaimer-btn--primary"
              data-testid="disclaimer-accept"
              disabled={!consented()}
              onClick={() => setDismissed(true)}
            >
              Продолжить
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
}
