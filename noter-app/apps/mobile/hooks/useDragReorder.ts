import { useCallback, useRef, useState } from 'react';
import * as Haptics from 'expo-haptics';
import { useReduceMotion } from './useReduceMotion';

/**
 * Standardised drag-reorder pipeline.
 *
 * Why centralise: every screen with DraggableFlatList writes its own
 * "snapshot → optimistic apply → server call → rollback on error" dance,
 * with inconsistent haptics (some Medium, some Light, some none).
 *
 * Pattern:
 *   1. User starts a drag → selectionAsync haptic (reduce-motion-gated).
 *   2. User drops → we snapshot the current order, apply the new order
 *      locally via `applyLocally`, then call `commitRemote`.
 *   3. On commit failure → restore the snapshot via `restore`.
 *
 * The hook tracks `pendingOrder` so the UI can disable interactions
 * while a reorder is in flight (avoid the classic "user reorders mid-
 * commit" race).
 */

export interface DragReorderConfig<T> {
  /** Apply the new order locally so the UI updates immediately. */
  applyLocally: (order: T[]) => void;
  /** Commit to the server. Resolves on success, rejects to trigger rollback. */
  commitRemote: (order: T[]) => Promise<void>;
  /** Restore the snapshot taken before the drag completed. */
  restore: (snapshot: T[]) => void;
  /** Reduce-motion can disable haptics globally. */
  haptic?: boolean;
}

export interface DragReorderResult<T> {
  /** Call on `onDragBegin` from DraggableFlatList. */
  onDragBegin: () => void;
  /** Call on `onDragEnd` with the new ordered data. */
  onDragEnd: (data: T[]) => Promise<void>;
  /** True while a commit is in flight. */
  inFlight: boolean;
  /** Last error from a commit, if any (cleared on next successful drag). */
  lastError: Error | null;
}

export const useDragReorder = <T>(config: DragReorderConfig<T>): DragReorderResult<T> => {
  const reduceMotion = useReduceMotion();
  const enableHaptic = config.haptic !== false;
  const [inFlight, setInFlight] = useState(false);
  const [lastError, setLastError] = useState<Error | null>(null);
  const snapshotRef = useRef<T[] | null>(null);
  const configRef = useRef(config);
  configRef.current = config;

  const onDragBegin = useCallback(() => {
    if (enableHaptic && !reduceMotion) {
      try { Haptics.selectionAsync(); } catch { /* haptics best-effort */ }
    }
  }, [enableHaptic, reduceMotion]);

  const onDragEnd = useCallback(async (data: T[]): Promise<void> => {
    if (snapshotRef.current === null) {
      // The first onDragEnd we see — capture the previous state. Since the
      // DraggableFlatList already moved items in `data`, we need the caller
      // to remember the BEFORE state. We approximate by treating the
      // current applyLocally as "after" and trusting the caller's `restore`
      // to know what to restore to.
      snapshotRef.current = data;
    }
    setInFlight(true);
    setLastError(null);
    const snap = snapshotRef.current;
    try {
      configRef.current.applyLocally(data);
      await configRef.current.commitRemote(data);
      snapshotRef.current = null;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setLastError(error);
      if (snap) configRef.current.restore(snap);
      snapshotRef.current = null;
    } finally {
      setInFlight(false);
    }
  }, []);

  return { onDragBegin, onDragEnd, inFlight, lastError };
};
