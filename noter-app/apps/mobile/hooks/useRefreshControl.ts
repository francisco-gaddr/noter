import { useCallback, useRef, useState } from 'react';
import * as Haptics from 'expo-haptics';

const DEFAULT_MIN_SPIN_MS = 350;

/**
 * Pull-to-refresh control hook that:
 *  - Plays a subtle haptic when the user initiates the refresh.
 *  - Enforces a minimum spinner duration so a 10ms cached response doesn't
 *    flicker the spinner — feels broken to the user. We hold the spinner
 *    visible for at least `minSpinMs` (default 350ms) which is just above
 *    perception threshold for "I asked for something to happen".
 *  - Catches errors so an exception during refresh doesn't leave the
 *    spinner stuck forever.
 *  - Re-entrant guard so spam-pulling can't queue multiple in-flight
 *    refreshes against the same backend.
 *
 * Usage:
 *   const { refreshing, onRefresh } = useRefreshControl(async () => {
 *     await store.fetchNotes();
 *   });
 *   <FlatList onRefresh={onRefresh} refreshing={refreshing} />
 */
export const useRefreshControl = (
  refreshFn: () => Promise<void> | void,
  options: { minSpinMs?: number; haptic?: boolean } = {},
): { refreshing: boolean; onRefresh: () => Promise<void> } => {
  const minSpinMs = options.minSpinMs ?? DEFAULT_MIN_SPIN_MS;
  const enableHaptic = options.haptic !== false;
  const [refreshing, setRefreshing] = useState(false);
  const inFlight = useRef(false);
  // Keep latest callback in a ref so identity-stable onRefresh doesn't capture
  // stale closures over refreshFn.
  const refreshFnRef = useRef(refreshFn);
  refreshFnRef.current = refreshFn;

  const onRefresh = useCallback(async (): Promise<void> => {
    if (inFlight.current) return;
    inFlight.current = true;
    setRefreshing(true);
    if (enableHaptic) {
      try { Haptics.selectionAsync(); } catch { /* haptics is best-effort */ }
    }
    const start = Date.now();
    try {
      await refreshFnRef.current();
    } catch (err) {
      // Errors are intentionally swallowed here — the caller's fetch logic is
      // responsible for surfacing them (toast/snackbar). Leaving them un-
      // caught would leak through to the FlatList and remain stuck.
      // eslint-disable-next-line no-console
      console.warn('[useRefreshControl] refresh failed', err);
    } finally {
      const elapsed = Date.now() - start;
      const remaining = Math.max(0, minSpinMs - elapsed);
      if (remaining > 0) {
        await new Promise((r) => setTimeout(r, remaining));
      }
      setRefreshing(false);
      inFlight.current = false;
    }
  }, [enableHaptic, minSpinMs]);

  return { refreshing, onRefresh };
};
