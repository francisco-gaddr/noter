/**
 * Helper to construct BrowserWindow options for a "note window" — a
 * lightweight secondary window opened via `noterDesktop.openNote(id)`.
 *
 * Pure function so the options shape can be unit-tested. The actual
 * BrowserWindow construction stays in main.js (so it can use the
 * windowState / acrylic / IsolatedWorld helpers already wired there).
 */

const path = require('path');

const ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

const buildNoteWindowOptions = (noteId, { preloadPath, isDev } = {}) => {
  if (typeof noteId !== 'string' || !ID_PATTERN.test(noteId)) {
    return { ok: false, reason: 'invalid-note-id' };
  }
  const opts = {
    width: 900,
    height: 700,
    minWidth: 480,
    minHeight: 360,
    show: false,
    title: `Note ${noteId}`,
    webPreferences: {
      preload: preloadPath || path.join(__dirname, '..', 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      spellcheck: true,
      devTools: !!isDev,
    },
  };
  return { ok: true, options: opts, deeplink: `/note/${noteId}` };
};

module.exports = { buildNoteWindowOptions, ID_PATTERN };
