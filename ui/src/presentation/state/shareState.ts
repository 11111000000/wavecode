import { createSignal } from 'solid-js';
import { encodeSnippet, decodeSnippet, SHARE_URL_LIMIT } from '~/domain/urlCodec';

/**
 * Reactive state for URL sharing.
 *
 * `shareUrl` — the URL currently in the share-modal preview (or null when closed).
 * `pendingEncoded` — encoded payload detected at app startup via `?s=`. If IDB
 *   also has content, the user is offered a "Load shared snippet" button to
 *   apply it.
 * `isLoadingShared` — true while a share is being applied (decoded, dispatched,
 *   modal closing).
 * `hasIdbScore` — set by App after `repo.loadScore()` resolves, used to decide
 *   whether to surface the "Load shared snippet" choice.
 */

const [shareUrl, setShareUrl] = createSignal<string | null>(null);
const [shareSize, setShareSize] = createSignal<number>(0);
const [shareSizeLimit] = createSignal<number>(SHARE_URL_LIMIT);
const [pendingEncoded, setPendingEncoded] = createSignal<string | null>(null);
const [isLoadingShared, setIsLoadingShared] = createSignal(false);
const [hasIdbScore, setHasIdbScore] = createSignal(false);

export const shareState = {
  shareUrl,
  shareSize,
  shareSizeLimit,
  pendingEncoded,
  isLoadingShared,
  hasIdbScore,
};

export const openShareModal = (score: string): void => {
  const result = encodeSnippet(score);
  if (result.ok) {
    setShareUrl(result.url);
    setShareSize(result.size);
  } else {
    setShareUrl(null);
    setShareSize(result.size);
  }
};

export const closeShareModal = (): void => {
  setShareUrl(null);
};

export const setPendingShare = (encoded: string | null): void => {
  setPendingEncoded(encoded);
};

/** Decode a pending share payload. Returns empty string on malformed input. */
export const decodePendingShare = (): string => {
  const encoded = pendingEncoded();
  if (!encoded) return '';
  return decodeSnippet(encoded);
};

export const startLoadingShared = (): void => {
  setIsLoadingShared(true);
  setPendingEncoded(null);
};

export const finishLoadingShared = (): void => {
  setIsLoadingShared(false);
};

export const markIdbHasScore = (has: boolean): void => {
  setHasIdbScore(has);
};
