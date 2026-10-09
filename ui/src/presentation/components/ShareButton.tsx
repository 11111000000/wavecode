import { Show, createSignal } from 'solid-js';
import { appStore, dispatch } from '../state/appStore';
import {
  shareState,
  openShareModal,
  closeShareModal,
  decodePendingShare,
  startLoadingShared,
  finishLoadingShared,
} from '../state/shareState';

/**
 * ShareButton — кнопка «🔗 Поделиться» в шапке.
 *
 * Клик открывает модалку с текущим encoded URL и кнопкой «Copy URL».
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

export function ShareButton() {
  const [copied, setCopied] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const onOpen = (): void => {
    setCopied(false);
    setError(null);
    openShareModal(appStore.score);
  };

  const onClose = (): void => {
    setCopied(false);
    setError(null);
    closeShareModal();
  };

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
      setError('Shared snippet повреждён — не удалось декодировать');
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
    <>
      <button
        type="button"
        class="preset-btn"
        onClick={onOpen}
        title="Поделиться текущей партитурой через URL"
      >
        🔗
      </button>

      <Show when={shareState.shareUrl() !== null || tooLarge()}>
        <div class="share-modal" role="dialog" aria-label="Поделиться партитурой">
          <div class="share-modal-inner">
            <h3 class="share-modal-title">🔗 Поделиться партитурой</h3>

            <Show when={!tooLarge()}>
              <input
                type="text"
                class="share-url"
                readonly
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
                  {copied() ? '✓ Скопировано' : '📋 Copy URL'}
                </button>
              </div>
            </Show>

            <Show when={tooLarge()}>
              <div class="share-modal-warn">
                ⚠ Партитура слишком длинная ({formatBytes(shareState.shareSize())} &gt;{' '}
                {formatBytes(shareState.shareSizeLimit())}). URL такого размера обрезают
                прокси и CDN. Лучше экспортируй партитуру в <code>.strudel.txt</code>{' '}
                через «📤 Текст» в панели партитуры и перешли файлом.
              </div>
            </Show>

            <Show when={shareState.pendingEncoded() !== null && shareState.hasIdbScore()}>
              <div class="share-modal-pending">
                <div class="share-modal-pending-msg">
                  В URL передан shared snippet, но у вас уже есть несохранённая локальная
                  работа. Загрузить shared snippet? Текущая партитура будет заменена.
                </div>
                <button
                  type="button"
                  class="share-modal-btn share-modal-load"
                  disabled={shareState.isLoadingShared()}
                  onClick={onLoadShared}
                >
                  📥 Загрузить shared snippet
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
      </Show>
    </>
  );
}
