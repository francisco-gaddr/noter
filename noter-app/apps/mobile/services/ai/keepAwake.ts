/**
 * Thin, reference-counted wrapper over expo-keep-awake.
 *
 * "Background AI work" and "background model download" both need the device to
 * not suspend the JS engine the moment the screen locks. expo-keep-awake keeps
 * the screen (and CPU) awake for as long as at least one holder is active; we
 * ref-count so that overlapping holders (a generation AND a download) don't
 * deactivate each other prematurely. Every call is best-effort — if the native
 * module is missing (e.g. Expo Go), it degrades to a no-op instead of throwing.
 */
let KeepAwake: { activateKeepAwakeAsync: (tag?: string) => Promise<void>; deactivateKeepAwake: (tag?: string) => Promise<void> } | null = null;
try {
  // Bundled with the `expo` package; resolvable in EAS builds.
  KeepAwake = require('expo-keep-awake');
} catch {
  KeepAwake = null;
}

const TAG = 'noter-ai';
let holders = 0;

/** Acquire a keep-awake lock. Returns a release fn (idempotent). */
export const acquireKeepAwake = (): (() => void) => {
  holders += 1;
  if (holders === 1) {
    KeepAwake?.activateKeepAwakeAsync(TAG).catch(() => {});
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holders = Math.max(0, holders - 1);
    if (holders === 0) {
      KeepAwake?.deactivateKeepAwake(TAG).catch(() => {});
    }
  };
};
