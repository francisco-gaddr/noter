import { useEffect, useRef } from 'react';
import { Image } from 'expo-image';
import { useNetworkPolicy } from './useNetworkPolicy';

/**
 * Pre-fetch a list of image URIs into the expo-image cache.
 *
 * Why: when a user opens a note that embeds several attachments, the
 * naïve flow renders each <Image /> independently and the user sees the
 * thumbnails pop in one by one. Prefetching the list up-front (or on
 * note hover/long-press, in the Electron path) lets the renderer paint
 * everything at once.
 *
 * Policy:
 *   - Skip when offline (no point burning the request) or on metered
 *     networks (don't blow the user's data cap on speculative fetches).
 *   - Skip URIs that aren't https://… or data:… — anything else is
 *     either malformed or untrusted.
 *   - Track which URIs were already fetched in this session via a
 *     module-level Set so re-renders don't re-issue the request. (The
 *     expo-image disk cache survives across sessions and is the
 *     authoritative dedup.)
 */

const sessionPrefetched = new Set<string>();

const HTTPS_URL = /^https:\/\//i;
const DATA_URL = /^data:image\//i;

const isPrefetchable = (uri: string): boolean => {
  if (typeof uri !== 'string' || uri.length === 0 || uri.length > 2048) return false;
  return HTTPS_URL.test(uri) || DATA_URL.test(uri);
};

export interface PrefetchOptions {
  /** Skip on cellular/metered/offline. Default true — opt in to "always prefetch" via false. */
  respectMeteredNetwork?: boolean;
  /** Limit how many uris to prefetch per call so a giant note doesn't dispatch 200 fetches. */
  maxBatch?: number;
}

export const useImagePrefetch = (uris: string[], opts: PrefetchOptions = {}): void => {
  const policy = useNetworkPolicy();
  const respect = opts.respectMeteredNetwork !== false;
  const maxBatch = opts.maxBatch ?? 12;
  // We want to prefetch when `uris` content changes, not on every render. We
  // hash by joined string — cheap for our typical < 20-element lists.
  const lastKeyRef = useRef('');

  useEffect(() => {
    const key = uris.join('|');
    if (key === lastKeyRef.current) return;
    lastKeyRef.current = key;
    if (!policy.isOnline) return;
    if (respect && policy.preferDeferLargeUploads) return;

    const filtered = uris
      .filter((u) => isPrefetchable(u) && !sessionPrefetched.has(u))
      .slice(0, maxBatch);
    if (filtered.length === 0) return;

    for (const u of filtered) sessionPrefetched.add(u);
    // expo-image's prefetch is fire-and-forget; we never await it because
    // failures are non-fatal and we don't want to delay the render.
    Image.prefetch(filtered).catch(() => undefined);
  }, [uris, policy.isOnline, policy.preferDeferLargeUploads, respect, maxBatch]);
};

// Test helpers
export const _isPrefetchable = isPrefetchable;
export const _clearSessionPrefetchCache = (): void => { sessionPrefetched.clear(); };
export const _sessionPrefetchSize = (): number => sessionPrefetched.size;
