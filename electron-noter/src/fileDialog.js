/**
 * Validators for native file-dialog (open/save) arguments.
 *
 * Why: the dialog API accepts a `filters` array of `{ name, extensions }`
 * that's not strictly typed by Electron. A renderer-injected filter list
 * with patterns like `['*']` or weird extensions can bypass our intent
 * of "this dialog only accepts notes/markdown". The validator clamps
 * everything to safe shapes before we hand it to dialog.show*().
 */

const path = require('path');

const ALLOWED_FILTERS = {
  notes: { name: 'Noter files', extensions: ['md', 'noter', 'txt'] },
  images: { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'heic'] },
  docs: { name: 'Documents', extensions: ['md', 'txt', 'html', 'json'] },
  pdf: { name: 'PDF', extensions: ['pdf'] },
};

const SAFE_PROPERTIES = new Set([
  'openFile', 'multiSelections', 'createDirectory',
  'showHiddenFiles', 'treatPackageAsDirectory', 'dontAddToRecent',
]);

const validateOpenDialogOptions = (raw, opts = {}) => {
  const safe = {
    title: typeof raw?.title === 'string' && raw.title.length <= 200 ? raw.title : 'Open File',
    properties: [],
    filters: [],
  };

  if (typeof raw?.defaultPath === 'string' && raw.defaultPath.length > 0 && raw.defaultPath.length <= 4096) {
    if (!raw.defaultPath.includes('\0')) {
      safe.defaultPath = path.resolve(raw.defaultPath);
    }
  }

  if (Array.isArray(raw?.properties)) {
    for (const p of raw.properties) {
      if (typeof p === 'string' && SAFE_PROPERTIES.has(p)) safe.properties.push(p);
    }
  }
  if (safe.properties.length === 0) safe.properties.push('openFile');

  // Filters: only the named ones from ALLOWED_FILTERS, OR a custom list
  // restricted to the same shape (no `['*']` wildcard).
  if (Array.isArray(raw?.allowedFilters)) {
    for (const name of raw.allowedFilters) {
      if (typeof name === 'string' && ALLOWED_FILTERS[name]) {
        safe.filters.push(ALLOWED_FILTERS[name]);
      }
    }
  }
  if (safe.filters.length === 0) {
    safe.filters.push({ name: 'All Files', extensions: ['*'] });
  }

  return safe;
};

const validateSaveDialogOptions = (raw) => {
  const safe = {
    title: typeof raw?.title === 'string' && raw.title.length <= 200 ? raw.title : 'Save File',
    filters: [],
  };

  if (typeof raw?.defaultPath === 'string' && raw.defaultPath.length > 0 && raw.defaultPath.length <= 4096) {
    if (!raw.defaultPath.includes('\0')) {
      safe.defaultPath = path.resolve(raw.defaultPath);
    }
  }

  if (Array.isArray(raw?.allowedFilters)) {
    for (const name of raw.allowedFilters) {
      if (typeof name === 'string' && ALLOWED_FILTERS[name]) {
        safe.filters.push(ALLOWED_FILTERS[name]);
      }
    }
  }
  if (safe.filters.length === 0) {
    // Save dialogs SHOULD have a constrained filter — but we don't want to
    // crash if caller forgot. Default to "notes" which is the common case.
    safe.filters.push(ALLOWED_FILTERS.notes);
  }

  if (typeof raw?.suggestedName === 'string' && raw.suggestedName.length > 0 && raw.suggestedName.length <= 256) {
    // Strip control chars so the filename doesn't break the OS save dialog.
    safe.suggestedName = raw.suggestedName.replace(/[\x00-\x1f\x7f<>:"/\\|?*]/g, '_');
  }

  return safe;
};

module.exports = {
  validateOpenDialogOptions,
  validateSaveDialogOptions,
  ALLOWED_FILTERS,
};
