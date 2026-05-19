/**
 * Centralised keyboard-shortcut registry for Noter desktop.
 *
 * Why a registry: previously accelerators were sprinkled inline in the menu
 * template, making it impossible to detect conflicts (e.g., "Cmd+F" used by
 * both find-in-page AND a future macro). The registry is the single source of
 * truth — appMenu, context-menu, and find-in-page all read from it.
 *
 * Each shortcut declares:
 *  - id: stable string used to look it up programmatically
 *  - label: shown in menus
 *  - accelerator: Electron accelerator string ('CmdOrCtrl+F')
 *  - scope: 'global' (any window) or 'window' (active window only)
 *  - description: shown in help/about dialog
 */

const SHORTCUTS = [
  {
    id: 'noter.newNote',
    label: 'New Note',
    accelerator: 'CmdOrCtrl+N',
    scope: 'window',
    description: 'Create a new note in the current view',
  },
  {
    id: 'noter.find',
    label: 'Find in Page…',
    accelerator: 'CmdOrCtrl+F',
    scope: 'window',
    description: 'Search within the current note',
  },
  {
    id: 'noter.findNext',
    label: 'Find Next',
    accelerator: 'CmdOrCtrl+G',
    scope: 'window',
    description: 'Jump to next find-in-page match',
  },
  {
    id: 'noter.findPrev',
    label: 'Find Previous',
    accelerator: 'CmdOrCtrl+Shift+G',
    scope: 'window',
    description: 'Jump to previous find-in-page match',
  },
  {
    id: 'noter.toggleTrayOnly',
    label: 'Toggle Tray-Only Mode',
    accelerator: 'CmdOrCtrl+Shift+T',
    scope: 'global',
    description: 'Hide/show Dock icon (macOS) and keep app in tray',
  },
  {
    id: 'noter.checkUpdate',
    label: 'Check for Updates…',
    accelerator: undefined,
    scope: 'global',
    description: 'Ask the auto-updater to look for a newer release',
  },
];

/**
 * Validate the registry at module load — throws on conflicting accelerators.
 * Catches typos before they hit users.
 */
const detectConflicts = (shortcuts) => {
  const seen = new Map();
  const conflicts = [];
  for (const s of shortcuts) {
    if (!s.accelerator) continue;
    const normalized = String(s.accelerator).toLowerCase();
    const prior = seen.get(normalized);
    if (prior) conflicts.push({ accelerator: s.accelerator, ids: [prior, s.id] });
    else seen.set(normalized, s.id);
  }
  return conflicts;
};

const conflicts = detectConflicts(SHORTCUTS);
if (conflicts.length > 0) {
  // Throw at module-load so the build fails fast.
  throw new Error(`Shortcut accelerator conflicts: ${JSON.stringify(conflicts)}`);
}

const byId = (id) => SHORTCUTS.find((s) => s.id === id);
const acceleratorFor = (id) => {
  const s = byId(id);
  return s ? s.accelerator : undefined;
};
const labelFor = (id) => {
  const s = byId(id);
  return s ? s.label : id;
};

module.exports = {
  SHORTCUTS,
  byId,
  acceleratorFor,
  labelFor,
  detectConflicts,
};
