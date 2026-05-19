import { useCallback, useRef, useState } from 'react';

/**
 * Generic optimistic-mutation helper.
 *
 * Pattern:
 *   - Caller invokes `mutate(input)`.
 *   - We immediately apply `applyLocally(input)` so the UI updates.
 *   - We call `commitRemote(input)` in the background.
 *   - On success → settle (no further action).
 *   - On failure → call `rollback(input, prevSnapshot)` to undo the
 *     local change, then surface the error.
 *
 * Why not just use the store directly: the rollback path is easy to
 * forget, and forgetting it leaves UI showing state the server never
 * accepted. This hook makes the rollback step structural.
 *
 * Integrates with the offline queue (round 7): if `commitRemote`
 * throws a network error, the caller can enqueue the mutation instead
 * of rolling back — pass `shouldRollback` to opt out per call.
 */

export interface OptimisticConfig<TInput, TSnapshot> {
  /** Snapshot the current state so we can restore it on failure. */
  snapshot: () => TSnapshot;
  /** Apply the change locally — runs synchronously before the network call. */
  applyLocally: (input: TInput) => void;
  /** Talk to the server. Resolves on success, rejects on failure. */
  commitRemote: (input: TInput) => Promise<void>;
  /** Restore the snapshot on failure. */
  rollback: (input: TInput, snapshot: TSnapshot) => void;
  /**
   * Decide per-call whether to rollback or accept the optimistic state
   * (e.g., enqueue to offline queue). Default true.
   */
  shouldRollback?: (error: Error, input: TInput) => boolean;
}

export interface OptimisticState<TInput> {
  inFlight: TInput | null;
  error: Error | null;
}

export const useOptimisticMutation = <TInput, TSnapshot>(
  config: OptimisticConfig<TInput, TSnapshot>,
): {
  mutate: (input: TInput) => Promise<void>;
  state: OptimisticState<TInput>;
  reset: () => void;
} => {
  const [state, setState] = useState<OptimisticState<TInput>>({ inFlight: null, error: null });
  const configRef = useRef(config);
  configRef.current = config;

  const mutate = useCallback(async (input: TInput): Promise<void> => {
    const cfg = configRef.current;
    const snap = cfg.snapshot();
    cfg.applyLocally(input);
    setState({ inFlight: input, error: null });
    try {
      await cfg.commitRemote(input);
      setState({ inFlight: null, error: null });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      const should = cfg.shouldRollback ? cfg.shouldRollback(error, input) : true;
      if (should) {
        cfg.rollback(input, snap);
      }
      setState({ inFlight: null, error });
      // Re-throw so callers can `await mutate(...)` and notice.
      throw error;
    }
  }, []);

  const reset = useCallback(() => {
    setState({ inFlight: null, error: null });
  }, []);

  return { mutate, state, reset };
};
