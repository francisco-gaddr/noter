/**
 * Validation for the macOS Sharing menu payload.
 *
 * Electron exposes `ShareMenu` (and the older Touch Bar / dialog APIs).
 * The payload is { texts?, urls?, filePaths? } — we sanitise each list
 * before invoking native so we never hand the OS an injected URL or a
 * traversal-path that could leak data the user didn't intend to share.
 */

const path = require('path');
const fs = require('fs');

const MAX_TEXT_LEN = 4000;
const MAX_URL_LEN = 2048;
const MAX_ENTRIES = 5;

const isHttpUrl = (u) => {
  if (typeof u !== 'string') return false;
  if (u.length === 0 || u.length > MAX_URL_LEN) return false;
  try {
    const parsed = new URL(u);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

const validateSharePayload = (payload, opts = {}) => {
  const out = { texts: [], urls: [], filePaths: [] };
  if (!payload || typeof payload !== 'object') return out;

  if (Array.isArray(payload.texts)) {
    for (const t of payload.texts.slice(0, MAX_ENTRIES)) {
      if (typeof t === 'string' && t.length > 0 && t.length <= MAX_TEXT_LEN) {
        // Strip control chars; the OS share sheet renders them as boxes.
        out.texts.push(t.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, ''));
      }
    }
  }

  if (Array.isArray(payload.urls)) {
    for (const u of payload.urls.slice(0, MAX_ENTRIES)) {
      if (isHttpUrl(u)) out.urls.push(u);
    }
  }

  if (Array.isArray(payload.filePaths)) {
    const allowedRoots = opts.allowedRoots || [];
    for (const f of payload.filePaths.slice(0, MAX_ENTRIES)) {
      if (typeof f !== 'string' || f.length === 0 || f.length > 4096) continue;
      if (f.includes('\0')) continue;
      const resolved = path.resolve(f);
      const inRoot = allowedRoots.length === 0
        ? true // no whitelist configured = trust caller (operator override)
        : allowedRoots.some((root) => resolved.startsWith(path.resolve(root) + path.sep));
      if (!inRoot) continue;
      // File must actually exist; the OS share sheet will fail silently if
      // it doesn't, leaving the user with a confused-empty-sheet experience.
      try {
        const stat = fs.statSync(resolved);
        if (!stat.isFile()) continue;
      } catch {
        continue;
      }
      out.filePaths.push(resolved);
    }
  }

  return out;
};

const hasShareablePayload = (validated) =>
  (validated.texts && validated.texts.length > 0) ||
  (validated.urls && validated.urls.length > 0) ||
  (validated.filePaths && validated.filePaths.length > 0);

module.exports = {
  validateSharePayload,
  hasShareablePayload,
  MAX_TEXT_LEN,
  MAX_URL_LEN,
  MAX_ENTRIES,
};
