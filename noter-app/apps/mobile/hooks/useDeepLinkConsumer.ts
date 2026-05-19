import { useEffect } from 'react';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';

/**
 * Consume `noter://` (custom protocol) and `https://daylited.com/note/<id>`
 * (universal links) and route them to the matching internal screen.
 *
 * Mirrors the Electron-side parser in src/deeplink.js (same allow-list)
 * so a `noter://note/<id>` link clicked on either platform takes the user
 * to the same place. Strict allow-list rejects path-traversal, foreign
 * protocols, and absolute redirects.
 *
 * Two firing paths:
 *   1. Initial URL: when the app was launched by the OS via a link.
 *      `Linking.getInitialURL()` returns it, we route once.
 *   2. While running: `Linking.addEventListener('url', …)` fires when a
 *      foreground link arrives.
 */

const NOTER_PROTOCOL = 'noter:';
const ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

const ALLOWED_HTTP_HOSTS = new Set([
  'daylited.com',
  'www.daylited.com',
]);

export interface ParsedDeepLink {
  type: 'note' | 'task' | 'open';
  id?: string;
  route: string;
}

export const parseAppDeepLink = (raw: string): ParsedDeepLink | null => {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 1024) return null;
  let url: URL;
  try { url = new URL(raw); } catch { return null; }

  if (url.protocol === NOTER_PROTOCOL) {
    const host = url.hostname;
    const segment = (url.pathname.replace(/^\//, '').split('/')[0] || '').trim();
    if (host === 'note' || host === 'task') {
      if (!ID_PATTERN.test(segment)) return null;
      return { type: host, id: segment, route: `/${host}/${segment}` };
    }
    if (host === 'open') {
      const route = url.searchParams.get('route');
      if (!route || !route.startsWith('/') || route.startsWith('//') || /^[a-z]+:/i.test(route) || route.includes('..')) {
        return null;
      }
      return { type: 'open', route };
    }
    return null;
  }

  if (url.protocol === 'https:' && ALLOWED_HTTP_HOSTS.has(url.hostname.toLowerCase())) {
    const parts = url.pathname.replace(/^\//, '').split('/');
    const kind = parts[0];
    const id = parts[1];
    if ((kind === 'note' || kind === 'task') && id && ID_PATTERN.test(id)) {
      return { type: kind, id, route: `/${kind}/${id}` };
    }
  }

  return null;
};

export const useDeepLinkConsumer = (enabled = true): void => {
  const router = useRouter();

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    const route = (link: ParsedDeepLink) => {
      try { router.push(link.route as any); } catch { /* expo-router may not be ready yet */ }
    };

    Linking.getInitialURL().then((raw) => {
      if (cancelled || !raw) return;
      const parsed = parseAppDeepLink(raw);
      if (parsed) route(parsed);
    }).catch(() => undefined);

    const sub = Linking.addEventListener('url', ({ url }) => {
      const parsed = parseAppDeepLink(url);
      if (parsed) route(parsed);
    });

    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [enabled, router]);
};

// Test exports
export const _ALLOWED_HTTP_HOSTS = ALLOWED_HTTP_HOSTS;
