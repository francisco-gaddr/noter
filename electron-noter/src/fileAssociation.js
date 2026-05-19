/**
 * Helpers for the .noter file-association flow.
 *
 * Pure functions:
 *   - extractOpenFilePathFromArgv(argv) → first .noter path in argv, or null
 *   - validateNoterFilePath(path) → boolean (existence + extension + safe shape)
 *
 * The actual association registration (handled at OS-install time by
 * electron-builder via fileAssociations[]) runs outside this file. What we
 * own here is the runtime path: when Electron is invoked with the file as
 * argv (Windows/Linux) OR the open-file event (macOS), extract the path
 * cleanly and route it to the renderer.
 */

const fs = require('fs');
const path = require('path');

const SUPPORTED_EXTENSIONS = new Set(['.noter', '.md', '.txt']);

const validateNoterFilePath = (raw) => {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 4096) return false;
  if (raw.includes('\0')) return false;
  const ext = path.extname(raw).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(ext)) return false;
  try {
    const stat = fs.statSync(raw);
    if (!stat.isFile()) return false;
    return true;
  } catch {
    return false;
  }
};

const extractOpenFilePathFromArgv = (argv) => {
  if (!Array.isArray(argv)) return null;
  for (const arg of argv) {
    if (typeof arg !== 'string') continue;
    if (arg.startsWith('-')) continue; // electron flags
    if (arg.startsWith('noter://')) continue; // deeplink path (different handler)
    const ext = path.extname(arg).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(ext)) continue;
    if (validateNoterFilePath(arg)) return path.resolve(arg);
  }
  return null;
};

module.exports = {
  validateNoterFilePath,
  extractOpenFilePathFromArgv,
  SUPPORTED_EXTENSIONS: Array.from(SUPPORTED_EXTENSIONS),
};
