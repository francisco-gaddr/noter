/**
 * Build the right-click context-menu for a given DOM context.
 *
 * `params` is the Electron `Event#params` shape from webContents
 * 'context-menu':
 *   - editFlags: { canCut, canCopy, canPaste, canSelectAll, canUndo, canRedo }
 *   - isEditable: true when the target is an <input>/<textarea>/[contenteditable]
 *   - selectionText: string of currently-selected text
 *   - mediaType: 'image' | 'video' | 'audio' | 'none' | ...
 *   - linkURL: anchor href when right-clicking a link
 *   - srcURL: media src when right-clicking media
 *
 * Pure function — returns a Menu template; caller passes it to
 * Menu.buildFromTemplate() and Menu#popup().
 */

const buildContextMenuTemplate = (params, ctx) => {
  const { isDev, on } = ctx;
  const editFlags = params.editFlags || {};
  const isEditable = params.isEditable;
  const hasSelection = typeof params.selectionText === 'string' && params.selectionText.length > 0;
  const hasLink = typeof params.linkURL === 'string' && params.linkURL.length > 0;

  const template = [];

  if (hasLink) {
    template.push({
      label: 'Open Link in Browser',
      click: () => on.openExternal && on.openExternal(params.linkURL),
    });
    template.push({
      label: 'Copy Link Address',
      click: () => on.writeClipboard && on.writeClipboard(params.linkURL),
    });
    template.push({ type: 'separator' });
  }

  if (isEditable) {
    if (editFlags.canUndo) template.push({ role: 'undo' });
    if (editFlags.canRedo) template.push({ role: 'redo' });
    if (editFlags.canUndo || editFlags.canRedo) template.push({ type: 'separator' });
    if (editFlags.canCut) template.push({ role: 'cut' });
    if (editFlags.canCopy) template.push({ role: 'copy' });
    if (editFlags.canPaste) template.push({ role: 'paste' });
    if (editFlags.canSelectAll) template.push({ role: 'selectAll' });
  } else {
    if (hasSelection && editFlags.canCopy) template.push({ role: 'copy' });
    if (editFlags.canSelectAll) template.push({ role: 'selectAll' });
  }

  if (hasSelection) {
    if (template.length > 0) template.push({ type: 'separator' });
    template.push({
      label: 'Find in Page…',
      click: () => on.find && on.find(params.selectionText),
    });
  }

  // Dev-only inspector. Coordinates come from `params.x`/`params.y` so the
  // inspector opens at the element the user right-clicked, not at (0,0).
  if (isDev) {
    if (template.length > 0) template.push({ type: 'separator' });
    template.push({
      label: 'Inspect Element',
      click: () => on.inspectElement && on.inspectElement(params.x, params.y),
    });
  }

  return template;
};

module.exports = { buildContextMenuTemplate };
