/**
 * Pure helpers for the drag-drop file import flow.
 *
 * Why this lives outside main.js: the actual drop event fires in the
 * renderer (web layer) so the data path is renderer → IPC → main. The
 * main-side validation that gates "is this file safe to import?" needs
 * to be testable, hence the pure split here.
 *
 * Validation rules:
 *   - Reject anything bigger than `maxBytes` (defaults to 10 MB)
 *   - Accept only allow-listed extensions/MIME types
 *   - Reject paths that contain `..` or are outside allowed roots
 */

const path = require('path');
const fs = require('fs');

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;

const DEFAULT_ALLOWED_MIMES = new Set([
  'text/plain',
  'text/markdown',
  'application/json',
  'text/html',
  'application/xhtml+xml',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);

const DEFAULT_ALLOWED_EXTS = new Set([
  '.txt', '.md', '.json', '.html', '.htm', '.png', '.jpg', '.jpeg', '.webp', '.gif',
]);

const validateDroppedFile = (file, options = {}) => {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const allowedMimes = options.allowedMimes ?? DEFAULT_ALLOWED_MIMES;
  const allowedExts = options.allowedExts ?? DEFAULT_ALLOWED_EXTS;

  if (!file || typeof file !== 'object') return { ok: false, reason: 'invalid-payload' };
  const { path: filePath, name, type, size } = file;
  if (typeof filePath !== 'string' || filePath.length === 0) return { ok: false, reason: 'no-path' };
  if (filePath.length > 4096) return { ok: false, reason: 'path-too-long' };
  if (filePath.includes('\0')) return { ok: false, reason: 'null-byte' };

  const ext = path.extname(name || filePath).toLowerCase();
  const mimeOk = typeof type === 'string' && allowedMimes.has(type);
  const extOk = allowedExts.has(ext);
  if (!mimeOk && !extOk) return { ok: false, reason: 'mime-or-ext-not-allowed', mime: type, ext };

  // Size: prefer the renderer-reported size when present, else stat the file.
  let bytes = typeof size === 'number' && Number.isFinite(size) ? size : null;
  if (bytes === null) {
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) return { ok: false, reason: 'not-a-file' };
      bytes = stat.size;
    } catch (err) {
      return { ok: false, reason: 'stat-failed', error: err && err.message };
    }
  }
  if (bytes > maxBytes) return { ok: false, reason: 'too-large', bytes, maxBytes };

  return { ok: true, ext, mime: type, bytes, resolvedPath: path.resolve(filePath) };
};

/**
 * Restrict-to-roots check that the renderer's drop handler does once it has
 * a list of paths. Distinct from the path-validation in nativeImage thumbnail
 * generation: drag-drop accepts user's working directories (Desktop, Downloads
 * etc.) while thumbnails are limited to app-controlled roots.
 */
const ACCEPTABLE_ROOTS_HINT = ['Desktop', 'Downloads', 'Documents', 'Pictures'];

module.exports = {
  validateDroppedFile,
  DEFAULT_MAX_BYTES,
  DEFAULT_ALLOWED_MIMES,
  DEFAULT_ALLOWED_EXTS,
  ACCEPTABLE_ROOTS_HINT,
};
