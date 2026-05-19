import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'expo-router';
import { kv } from '@/services/storage';

const STORAGE_KEY = '__noter_last_route__';
const RESTORE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

interface StoredRoute {
  path: string;
  ts: number;
}

// Prefix-based rejection list — anything matching one of these prefixes is
// treated as auth/overlay and never restored.
const NON_RESTORABLE_PREFIXES = [
  '/auth/',
  '/modal',
];

// Exact-match rejection list — bare root paths.
const NON_RESTORABLE_EXACT = new Set(['/']);

const isRestorable = (path: string): boolean => {
  if (typeof path !== 'string' || path.length === 0) return false;
  if (NON_RESTORABLE_EXACT.has(path)) return false;
  if (NON_RESTORABLE_PREFIXES.some((p) => path === p || path.startsWith(p))) return false;
  // Restrict to internal-route syntax: starts with '/', no protocol, no '..'.
  if (!path.startsWith('/')) return false;
  if (path.startsWith('//')) return false;
  if (/^[a-z]+:/i.test(path)) return false;
  if (path.includes('..')) return false;
  if (path.length > 256) return false;
  return true;
};

/**
 * Persist the current route on every navigation and restore it on cold-start
 * if it's < 1h old.
 *
 * Why 1h: longer windows surprise the user — "why is my app showing the
 * note I read at lunch yesterday?" — and shorter ones don't actually
 * cover the common case of accidentally killing the app.
 *
 * Restoration runs ONCE on mount. Subsequent navigations save but don't
 * trigger restore. The hook lives in RootLayoutNav so it has access to
 * the router after the navigator tree is mounted.
 */
export const useRouteRestore = (enabled = true): void => {
  const pathname = usePathname();
  const router = useRouter();
  const restoredOnce = useRef(false);

  // Restore once at mount.
  useEffect(() => {
    if (!enabled || restoredOnce.current) return;
    restoredOnce.current = true;
    (async () => {
      try {
        const raw = await kv.getString(STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw) as StoredRoute;
        if (!parsed || typeof parsed.path !== 'string' || typeof parsed.ts !== 'number') return;
        if (Date.now() - parsed.ts > RESTORE_WINDOW_MS) return;
        if (!isRestorable(parsed.path)) return;
        // Only restore when the user landed on the default route ("/" or
        // tabs root). If they already navigated somewhere, respect their
        // choice.
        if (pathname && pathname !== '/' && pathname !== '/(tabs)' && !pathname.startsWith('/(tabs)/index')) return;
        router.replace(parsed.path as any);
      } catch {
        // corrupt entry — clear it
        await kv.delete(STORAGE_KEY).catch(() => undefined);
      }
    })();
    // Intentionally don't depend on pathname/router to avoid re-running.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // Persist every navigation.
  useEffect(() => {
    if (!enabled || !pathname || !isRestorable(pathname)) return;
    const entry: StoredRoute = { path: pathname, ts: Date.now() };
    kv.setString(STORAGE_KEY, JSON.stringify(entry)).catch(() => undefined);
  }, [pathname, enabled]);
};

// Test helpers
export const _isRestorable = isRestorable;
export const _STORAGE_KEY = STORAGE_KEY;
export const _RESTORE_WINDOW_MS = RESTORE_WINDOW_MS;
