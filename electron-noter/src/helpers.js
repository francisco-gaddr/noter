/**
 * Pure helper functions extracted from main.js so they can be unit-tested
 * without an Electron runtime. Anything in this file must NOT require electron.
 */

const os = require('os');
const path = require('path');
const fs = require('fs');

const isWindows11 = (platform = process.platform, release = os.release()) => {
  if (platform !== 'win32') return false;
  try {
    const parts = String(release).split('.').map((v) => parseInt(v, 10));
    if (parts.length < 3) return false;
    if (parts[0] > 10) return true;
    if (parts[0] === 10 && parts[2] >= 22000) return true;
    return false;
  } catch {
    return false;
  }
};

/**
 * Validate a spell-check dictionary CDN URL. Returns the normalised value
 * (trailing slash) when accepted, null when rejected. Pure function — caller
 * is responsible for actually passing the result to setSpellCheckerDictionaryDownloadURL.
 */
const validateSpellCheckerCdn = (raw) => {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const normalized = trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
  let url;
  try { url = new URL(normalized); } catch { return null; }
  if (url.protocol !== 'https:') return null;
  return normalized;
};

/**
 * Validate that a requested thumbnail path is inside the allowed user-data
 * roots. Returns the resolved absolute path on success, throws on rejection.
 *
 * `safeRoots` is injected so callers can pass app.getPath() results without
 * this helper needing to know about electron.
 */
const validateThumbnailPath = (filePath, safeRoots) => {
  if (typeof filePath !== 'string' || filePath.length === 0) {
    throw new Error('filePath required');
  }
  const resolved = path.resolve(filePath);
  const allowed = (safeRoots || []).some((root) => {
    try { return resolved.startsWith(path.resolve(root) + path.sep); } catch { return false; }
  });
  if (!allowed) throw new Error('thumbnail: path outside allowed roots');
  if (!fs.existsSync(resolved)) throw new Error('thumbnail: file not found');
  return resolved;
};

/**
 * Clamp a thumbnail size to [16,512] per axis.
 */
const clampThumbnailSize = (size, fallback = 128) => {
  const w = Number(size && size.width) || fallback;
  const h = Number(size && size.height) || fallback;
  return {
    width: Math.max(16, Math.min(w, 512)),
    height: Math.max(16, Math.min(h, 512)),
  };
};

/**
 * Allow-list registry for isolated-world DOM scripts. Each entry takes an
 * `arg` and returns a string of JavaScript to execute. We keep the registry
 * here so tests can verify allow-list enforcement without depending on
 * webContents.
 */
const ISOLATED_SCRIPTS = new Map([
  ['highlight-search', (term) => {
    if (typeof term !== 'string' || term.length === 0) return 'noop';
    return `(function () {
      const term = ${JSON.stringify(term)};
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const hits = [];
      let n;
      while ((n = walker.nextNode())) {
        if (n.nodeValue && n.nodeValue.toLowerCase().includes(term.toLowerCase())) {
          hits.push(n.nodeValue);
        }
      }
      return hits.length;
    })();`;
  }],
]);

const buildIsolatedScript = (scriptKey, arg) => {
  const factory = ISOLATED_SCRIPTS.get(scriptKey);
  if (!factory) throw new Error(`unknown isolated script: ${scriptKey}`);
  return factory(arg);
};

module.exports = {
  isWindows11,
  validateSpellCheckerCdn,
  validateThumbnailPath,
  clampThumbnailSize,
  buildIsolatedScript,
  ISOLATED_SCRIPTS,
};
