import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';

/**
 * URL-share codec: pure functions to encode/decode Strudel snippets
 * for inclusion in a shareable URL.
 *
 * Encoding pipeline:
 *   text  →  LZString.compressToEncodedURIComponent  →  URI-safe base64
 *   +  ?s=<encoded>&t=<unix-ms>
 *
 * The encoded form is safe to drop directly into `location.search` —
 * no `encodeURIComponent` wrapping needed.
 *
 * Size policy: practical URL length across proxies and CDNs is ≈ 8KB
 * (some cut at 2KB). Above 8KB we return `{ok: false, reason: 'too-large'}`
 * so the UI can prompt the user to export as `.strudel.txt` instead.
 *
 * Decoding is best-effort: a malformed payload yields an empty string
 * rather than throwing — the caller is expected to discard it.
 */

export const SHARE_URL_LIMIT = 8 * 1024;

export const SHARE_PARAM = 's';
export const SHARE_TS_PARAM = 't';

export type EncodeResult =
  | { readonly ok: true; readonly url: string; readonly size: number }
  | { readonly ok: false; readonly reason: 'too-large'; readonly size: number; readonly limit: number };

export const encodeSnippet = (score: string): EncodeResult => {
  const safeScore = typeof score === 'string' ? score : '';
  const encoded = compressToEncodedURIComponent(safeScore);
  const ts = Date.now();
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const path = typeof window !== 'undefined' ? window.location.pathname : '/';
  const url = `${origin}${path}?${SHARE_PARAM}=${encoded}&${SHARE_TS_PARAM}=${ts}`;
  const size = url.length;
  if (size > SHARE_URL_LIMIT) {
    return { ok: false, reason: 'too-large', size, limit: SHARE_URL_LIMIT };
  }
  return { ok: true, url, size };
};

export const decodeSnippet = (encoded: string): string => {
  if (!encoded) return '';
  try {
    return decompressFromEncodedURIComponent(encoded) ?? '';
  } catch {
    return '';
  }
};

export const parseShareUrl = (search: string): string | null => {
  if (!search) return null;
  const query = search.startsWith('?') ? search.slice(1) : search;
  if (!query) return null;
  const params = new URLSearchParams(query);
  const s = params.get(SHARE_PARAM);
  if (!s) return null;
  return s;
};
