import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import NetInfo from '@react-native-community/netinfo';

const DEFAULT_DEBOUNCE_MS = 5_000;
const DEFAULT_COOLDOWN_MS = 60_000;

/**
 * Trigger a sync callback when the app comes back to the foreground.
 *
 * Guards:
 *  - Debounced so rapid background/foreground flicker (notification glance)
 *    doesn't fire multiple syncs back-to-back.
 *  - Cooldown so even legitimate fg events can't fire more than 1× per
 *    minute (default) — protects against accidental quadratic load on the
 *    backend if the user is bouncing between apps.
 *  - Net-info gated: skip the sync if the device is offline. NetInfo is
 *    queried lazily on each fg event rather than subscribed continuously,
 *    keeping the hook free of subscription bookkeeping.
 *
 * Idempotent on unmount — the AppState subscription is removed cleanly.
 */
export const useAppForegroundSync = (
  onForeground: () => void | Promise<void>,
  options: { debounceMs?: number; cooldownMs?: number } = {},
): void => {
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  const callbackRef = useRef(onForeground);
  callbackRef.current = onForeground;

  const lastFiredAtRef = useRef<number>(0);
  const lastStateRef = useRef<AppStateStatus>(AppState.currentState);
  // ReturnType<typeof setTimeout> is portable across the RN (number) and @types/node
  // (Timeout) ambient typings — hard-coding NodeJS.Timeout breaks when the DOM/RN lib
  // wins the setTimeout overload.
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const fire = async () => {
      const now = Date.now();
      if (now - lastFiredAtRef.current < cooldownMs) return;
      try {
        const netState = await NetInfo.fetch();
        if (!netState.isConnected) return;
      } catch {
        // If NetInfo fails for any reason we still let the sync attempt — the
        // sync layer itself will retry on network error.
      }
      lastFiredAtRef.current = Date.now();
      try { await callbackRef.current(); } catch { /* sync errors are reported elsewhere */ }
    };

    const handleChange = (next: AppStateStatus) => {
      const prev = lastStateRef.current;
      lastStateRef.current = next;
      // Treat any of background/inactive → active as a "foreground" transition.
      if (next === 'active' && (prev === 'background' || prev === 'inactive')) {
        if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = setTimeout(() => { void fire(); }, debounceMs);
      }
    };

    const sub = AppState.addEventListener('change', handleChange);
    return () => {
      sub.remove();
      if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
    };
  }, [debounceMs, cooldownMs]);
};
