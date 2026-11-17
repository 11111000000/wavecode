import { type JSX } from 'solid-js';
import { appStore } from '../state/appStore';
import { ShareIcon } from '../icons';
import { openShareDialog } from '../state/shareState';

/**
 * ShareButton — кнопка «🔗 Поделиться» в шапке.
 *
 * wavecode-mobile-topbar: сама модалка живёт в ShareDialog (она нужна
 * в двух местах — здесь и в меню «Ещё» на мобиле), а кнопка осталась
 * простым триггером. На узких экранах кнопка скрывается CSS-ом: там
 * «Поделиться» переезжает в меню «Ещё», потому что в шапке не
 * помещалось шесть кнопок подряд (см. OverflowMenu).
 */
export function ShareButton(): JSX.Element {
  return (
    <button
      type="button"
      class="preset-btn wc-topbar__share"
      onClick={() => openShareDialog(appStore.score)}
      title="Поделиться текущей партитурой через URL"
      aria-label="Поделиться партитурой"
    >
      <ShareIcon size={16} />
    </button>
  );
}
