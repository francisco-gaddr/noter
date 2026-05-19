/**
 * Pure helpers for the auto-updater UI state.
 *
 * The renderer needs a single normalised model of the updater lifecycle
 * so the toast/banner can react without inspecting raw electron-updater
 * events. This module transforms each event into a typed `UpdaterState`
 * and exposes a reducer-style aggregator.
 *
 * States:
 *   - 'idle'        — no recent activity
 *   - 'checking'    — looking for an update
 *   - 'available'   — an update was found; download starts automatically
 *   - 'downloading' — bytes are streaming; progress 0..100
 *   - 'ready'       — fully downloaded; user can apply
 *   - 'error'       — last check/download failed
 *   - 'rejected'    — signature verification refused the binary
 *
 * The aggregator handles out-of-order events gracefully (e.g. a 'progress'
 * after we already saw 'ready' is ignored).
 */

const TERMINAL_STATES = new Set(['ready', 'error', 'rejected']);

const INITIAL_STATE = {
  status: 'idle',
  version: null,
  progress: null,
  error: null,
  updatedAt: 0,
};

const isFinite = (n) => typeof n === 'number' && Number.isFinite(n);

const clamp01 = (n) => {
  if (!isFinite(n)) return null;
  return Math.max(0, Math.min(100, n));
};

const reduce = (current, event) => {
  if (!event || typeof event !== 'object') return current;
  const next = { ...current, updatedAt: Date.now() };
  const type = String(event.type || '');
  const data = event.data || {};

  switch (type) {
    case 'checking':
      next.status = 'checking';
      next.error = null;
      break;
    case 'available':
      next.status = 'available';
      next.version = typeof data.version === 'string' ? data.version : current.version;
      break;
    case 'not-available':
      // If we're already past the check stage (e.g., downloaded), don't
      // regress to idle.
      if (!TERMINAL_STATES.has(current.status)) next.status = 'idle';
      break;
    case 'progress':
      // Ignore stale progress after ready/rejected.
      if (current.status === 'ready' || current.status === 'rejected') return current;
      next.status = 'downloading';
      next.progress = {
        percent: clamp01(data.percent),
        bytesPerSecond: isFinite(data.bytesPerSecond) ? Math.floor(data.bytesPerSecond) : null,
        transferred: isFinite(data.transferred) ? data.transferred : null,
        total: isFinite(data.total) ? data.total : null,
      };
      break;
    case 'ready':
      next.status = 'ready';
      next.version = typeof data.version === 'string' ? data.version : current.version;
      next.progress = { ...(current.progress || {}), percent: 100 };
      break;
    case 'rejected':
      next.status = 'rejected';
      next.error = typeof data.reason === 'string' ? data.reason : 'rejected';
      break;
    case 'error': {
      next.status = 'error';
      const msg = typeof data.message === 'string' ? data.message : 'unknown error';
      next.error = msg.length > 200 ? `${msg.slice(0, 200)}…` : msg;
      break;
    }
    default:
      // Unknown event types pass through without changing state — defensive
      // against future electron-updater additions.
      return current;
  }

  return next;
};

const createUpdaterStateMachine = () => {
  let state = { ...INITIAL_STATE };
  return {
    dispatch: (event) => { state = reduce(state, event); return state; },
    get: () => state,
    reset: () => { state = { ...INITIAL_STATE }; },
  };
};

module.exports = {
  createUpdaterStateMachine,
  reduce,
  INITIAL_STATE,
  TERMINAL_STATES: Array.from(TERMINAL_STATES),
};
