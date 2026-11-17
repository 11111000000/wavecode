import { Show, createEffect, createSignal, onCleanup, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import { appStore, dispatch } from '../state/appStore';
import {
  shareState,
  openShareDialog,
  closeShareDialog,
  decodePendingShare,
  startLoadingShared,
  finishLoadingShared,
} from '../state/shareState';

/**
 * ShareDialog — модалка «Поделиться партитурой».
 *
 * wavecode-mobile-topbar: модалка вынесена из кнопки отдельным
 * компонентом, потому что на телефоне «Поделиться» живёт в меню
 * «Ещё», а не в шапке: в шапке на 390px не помещалось шесть кнопок
 * подряд, и статус «остановлен» наезжал на «Новую композицию».
 * Открытость — в общем `shareState`, поэтому любой вызывающий
 * (кнопка в шапке или пункт меню) открывает одну и ту же модалку.
 *
 * Если закодированный score > 8KB — вместо URL показывается warning
 * «слишком длинный, лучше экспортируй .strudel.txt».
 *
 * Если при mount был pending share (URL `?s=...`) И в IDB уже есть
 * сохранённый score, в модалке появляется кнопка «📥 Загрузить shared
 * snippet» — пользователь явно подтверждает перезапись локальной работы.
 */

const copyToClipboard = async (text: string): Promise<boolean> => {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // secure context missing или permission denied — fallback ниже
    }
  }
  if (typeof document === 'undefined') return false;
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    ta.style.pointerEvents = 'none';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
};

const formatBytes = (n: number): string => {
  if (n < 1024) return `${n} B`;
  return `${(n / 1024).toFixed(1)} KB`;
};

export function ShareDialog(): JSX.Element {
  const [copied, setCopied] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  let panel: HTMLDivElement | undefined;

  const onClose = (): void => {
    setCopied(false);
    setError(null);
    closeShareDialog();
  };

  // Esc closes the modal. Without a keyboard escape the only way out
  // is the «Закрыть» button, which on short viewports sits under the
  // transport-bar overlay and swallows the click — the modal then
  // traps the user.
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    onClose();
  };

  // Фокус на панель — клавиатура сразу может закрыть окно по Esc, а
  // копирование не требует ни клика, ни прокрутки.
  createEffect(() => {
    if (!shareState.isOpen()) return;
    setCopied(false);
    setError(null);
    queueMicrotask(() => panel?.focus());
  });

  onCleanup(() => {
    setCopied(false);
    setError(null);
  });

  const onCopy = async (): Promise<void> => {
    const url = shareState.shareUrl();
    if (!url) return;
    const ok = await copyToClipboard(url);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } else {
      setError('Не удалось скопировать (clipboard API недоступен)');
    }
  };

  const onLoadShared = (): void => {
    const text = decodePendingShare();
    if (!text) {
      setError('Сниппет повреждён — не удалось декодировать');
      return;
    }
    startLoadingShared();
    dispatch({ type: 'replaceScore', text });
    finishLoadingShared();
    setError(null);
    onClose();
  };

  const tooLarge = (): boolean => {
    const size = shareState.shareSize();
    const limit = shareState.shareSizeLimit();
    return size > 0 && size > limit;
  };

  return (
    <Show when={shareState.isOpen() && (shareState.shareUrl() !== null || tooLarge())}>
      <Portal>
        <div
          class="share-modal-backdrop"
          onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
          <div
            class="share-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Поделиться партитурой"
            tabindex={-1}
            ref={panel}
            onKeyDown={onKeyDown}
          >
            <div class="share-modal-inner">
              <h3 class="share-modal-title">Поделиться партитурой</h3>

              <Show when={!tooLarge()}>
                <input
                  type="text"
                  class="share-url"
                  readonly
                  aria-label="Ссылка на партитуру"
                  value={shareState.shareUrl() ?? ''}
                  onFocus={(e) => e.currentTarget.select()}
                />
                <div class="share-modal-meta">
                  <span class="share-modal-size">
                    {formatBytes(shareState.shareSize())} / {formatBytes(shareState.shareSizeLimit())}
                  </span>
                  <button
                    type="button"
                    class="share-modal-btn share-modal-copy"
                    onClick={() => void onCopy()}
                  >
                    {copied() ? '✓ Скопировано' : 'Скопировать ссылку'}
                  </button>
                </div>
              </Show>

              <Show when={tooLarge()}>
                <div class="share-modal-warn">
                  ⚠ Партитура слишком длинная ({formatBytes(shareState.shareSize())} &gt;{' '}
                  {formatBytes(shareState.shareSizeLimit())}). URL такого размера обрезают
                  прокси и CDN. Лучше экспортируй партитуру в <code>.strudel.txt</code>{' '}
                  через «Инструменты → Экспорт» и перешли файлом.
                </div>
              </Show>

              <Show when={shareState.pendingEncoded() !== null && shareState.hasIdbScore()}>
                <div class="share-modal-pending">
                  <div class="share-modal-pending-msg">
                    В URL передан сниппет, но у вас уже есть несохранённая локальная
                    работа. Загрузить сниппет? Текущая партитура будет заменена.
                  </div>
                  <button
                    type="button"
                    class="share-modal-btn share-modal-load"
                    disabled={shareState.isLoadingShared()}
                    onClick={onLoadShared}
                  >
                    📥 Загрузить сниппет
                  </button>
                </div>
              </Show>

              <Show when={error()}>
                <div class="share-modal-err">{error()}</div>
              </Show>

              <div class="share-modal-actions">
                <button type="button" class="share-modal-btn" onClick={onClose}>
                  Закрыть
                </button>
              </div>
            </div>
          </div>
        </div>
      </Portal>
    </Show>
  );
}

/** Открыть модалку из любого места — с текущей партитурой. */
export const openShare = (): void => {
  openShareDialog(appStore.score);
};
