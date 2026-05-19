/**
 * Renderer-crash recovery policy.
 *
 * When the renderer process dies (out-of-memory, hung WebGL ctx, native-
 * extension segfault), Electron emits `render-process-gone` on the
 * BrowserWindow. We auto-reload up to N times in a sliding window, then
 * give up and show the user a dialog asking whether to keep retrying or
 * quit.
 *
 * This module owns the COUNTING. Whether to actually reload or show a
 * dialog is decided by the caller (main.js) based on what this returns.
 *
 * Pure: takes "now" as a callback so tests can drive the clock.
 */

const DEFAULT_MAX_CRASHES = 3;
const DEFAULT_WINDOW_MS = 5 * 60 * 1000; // 5 min

const createRecoveryPolicy = (opts = {}) => {
  const maxCrashes = opts.maxCrashes ?? DEFAULT_MAX_CRASHES;
  const windowMs = opts.windowMs ?? DEFAULT_WINDOW_MS;
  const now = opts.now ?? (() => Date.now());
  const crashes = [];

  return {
    /**
     * Record a crash and decide what to do.
     * Returns one of:
     *   - { action: 'reload' }     — auto-reload silently
     *   - { action: 'prompt' }     — show the user a "retry / quit?" dialog
     *   - { action: 'ignore' }     — don't reload (e.g., killed by user-action)
     */
    recordCrash(reason) {
      // Some `render-process-gone` reasons aren't crashes we should react to.
      // 'killed' usually means the OS or the user killed the process explicitly.
      // 'clean-exit' is a normal shutdown.
      if (reason === 'clean-exit' || reason === 'killed') {
        return { action: 'ignore' };
      }
      const t = now();
      crashes.push(t);
      // Slide the window — drop crashes older than windowMs.
      while (crashes.length > 0 && crashes[0] < t - windowMs) crashes.shift();
      if (crashes.length > maxCrashes) {
        return { action: 'prompt', recentCount: crashes.length, windowMs };
      }
      return { action: 'reload', attempt: crashes.length };
    },

    reset() {
      crashes.length = 0;
    },

    state() {
      return { recentCount: crashes.length, windowMs, maxCrashes };
    },
  };
};

module.exports = {
  createRecoveryPolicy,
  DEFAULT_MAX_CRASHES,
  DEFAULT_WINDOW_MS,
};
