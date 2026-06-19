/**
 * Trailing-edge debounce. Coalesces a burst of calls into a single invocation `delayMs` after the
 * LAST call — the standard way to turn a chatty trigger (e.g. "notes changed" on every keystroke)
 * into one bounded action (e.g. "re-index"). Framework-free so it is shared by web + mobile.
 */
export interface Debounced<A extends unknown[]> {
  (...args: A): void;
  /** Cancel a pending invocation (call on teardown so nothing fires after unmount). */
  cancel(): void;
}

export const createDebounced = <A extends unknown[]>(
  fn: (...args: A) => void,
  delayMs: number,
): Debounced<A> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const debounced = ((...args: A) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      fn(...args);
    }, Math.max(0, delayMs));
  }) as Debounced<A>;
  debounced.cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
  };
  return debounced;
};
