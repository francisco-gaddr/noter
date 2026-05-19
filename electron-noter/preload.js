const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mlc', {
  isElectron: true,
  getModels: () => ipcRenderer.invoke('mlc:get-models'),
  searchModels: (payload) => ipcRenderer.invoke('mlc:search-models', payload),
  getModelFiles: (payload) => ipcRenderer.invoke('mlc:get-model-files', payload),
  downloadAndConvert: (payload) => ipcRenderer.invoke('mlc:download', payload),
  deleteModel: (payload) => ipcRenderer.invoke('mlc:delete', payload),
  chat: (payload) => ipcRenderer.invoke('mlc:chat', payload),
  cancelChat: (payload) => ipcRenderer.invoke('mlc:cancel-chat', payload),
  onDownloadProgress: (handler) => {
    const listener = (_event, data) => handler(data);
    ipcRenderer.on('mlc:download-progress', listener);
    return () => ipcRenderer.removeListener('mlc:download-progress', listener);
  },
  onChatToken: (handler) => {
    const listener = (_event, data) => handler(data);
    ipcRenderer.on('mlc:chat-token', listener);
    return () => ipcRenderer.removeListener('mlc:chat-token', listener);
  },
  getSetting: (key) => ipcRenderer.invoke('settings:get', key),
  setSetting: (key, value) => ipcRenderer.invoke('settings:set', { key, value })
});

contextBridge.exposeInMainWorld('noterDesktop', {
  isElectron: true,
  // Search thumbnails
  createThumbnail: (filePath, size) =>
    ipcRenderer.invoke('thumbnails:create', { path: filePath, size }),

  // Safe DOM operations via isolated world
  runIsolatedScript: (scriptKey, arg) =>
    ipcRenderer.invoke('dom:run-isolated', { scriptKey, arg }),

  // System theme signal
  onThemeChanged: (handler) => {
    const listener = (_event, data) => handler(data);
    ipcRenderer.on('theme:updated', listener);
    return () => ipcRenderer.removeListener('theme:updated', listener);
  },

  // Preferences that flip OS-level behaviour
  setOpenAtLogin: (enabled) =>
    ipcRenderer.invoke('settings:set', { key: 'openAtLogin', value: enabled === true }),
  setTrayOnly: (enabled) =>
    ipcRenderer.invoke('settings:set', { key: 'trayOnly', value: enabled === true }),
  setSpellCheckerCdn: (url) =>
    ipcRenderer.invoke('settings:set', { key: 'spellCheckerCdn', value: typeof url === 'string' ? url : null }),

  // Auto-updater
  checkForUpdate: () => ipcRenderer.invoke('updater:check-now'),
  installUpdateNow: () => ipcRenderer.invoke('updater:install-now'),
  getUpdaterState: () => ipcRenderer.invoke('updater:get-state'),
  onUpdaterEvent: (handler) => {
    const events = ['updater:available', 'updater:not-available', 'updater:progress', 'updater:ready', 'updater:error', 'updater:rejected'];
    const listeners = events.map((evt) => {
      const listener = (_event, data) => handler({ type: evt.replace('updater:', ''), data });
      ipcRenderer.on(evt, listener);
      return { evt, listener };
    });
    return () => listeners.forEach(({ evt, listener }) => ipcRenderer.removeListener(evt, listener));
  },
  /**
   * Normalised state-machine view of the updater. Renderer should
   * prefer this over the raw event stream — it handles out-of-order
   * events + ignores stale ones.
   */
  onUpdaterState: (handler) => {
    const listener = (_event, state) => handler(state);
    ipcRenderer.on('updater:state', listener);
    return () => ipcRenderer.removeListener('updater:state', listener);
  },

  // Find-in-page
  findStart: (text, opts) => ipcRenderer.invoke('find:start', { text, ...(opts || {}) }),
  findNext: (text, forward = true) => ipcRenderer.invoke('find:next', { text, forward }),
  findStop: (action) => ipcRenderer.invoke('find:stop', { action }),
  onFindResult: (handler) => {
    const listener = (_event, data) => handler(data);
    ipcRenderer.on('find:result', listener);
    return () => ipcRenderer.removeListener('find:result', listener);
  },

  // Native notifications
  notify: (payload) => ipcRenderer.invoke('notify:show', payload),
  onNoteOpenRequested: (handler) => {
    const listener = (_event, data) => handler(data);
    ipcRenderer.on('note:open', listener);
    return () => ipcRenderer.removeListener('note:open', listener);
  },

  // Dock / launcher badge (macOS + Linux/Unity). No-op on Windows.
  setBadge: (count) => ipcRenderer.invoke('badge:set', { count }),

  // Drag-drop file import
  validateDroppedFiles: (files) => ipcRenderer.invoke('drop:validate', files),
  readDroppedFile: (file) => ipcRenderer.invoke('drop:read', file),

  // macOS Sharing menu (no-op on other platforms)
  openShareMenu: (payload) => ipcRenderer.invoke('share:open', payload),

  // Touch Bar (macOS)
  setTouchBar: (context) => ipcRenderer.invoke('touchbar:set', { context }),
  onTouchBarAction: (handler) => {
    const actions = ['newNote', 'find', 'save', 'findPrev', 'findNext', 'findStop', 'openSettings'];
    const listeners = actions.map((a) => {
      const evt = `action:${a}`;
      const listener = () => handler({ action: a });
      ipcRenderer.on(evt, listener);
      return { evt, listener };
    });
    return () => listeners.forEach(({ evt, listener }) => ipcRenderer.removeListener(evt, listener));
  },

  // Print + printToPDF
  printNote: (options, lockedNote = false) => ipcRenderer.invoke('print:show', { options, lockedNote }),
  printNoteToPdf: (options, lockedNote = false) => ipcRenderer.invoke('print:to-pdf', { options, lockedNote }),
  openPrintPreview: (options, title, lockedNote = false) =>
    ipcRenderer.invoke('print:preview', { options, title, lockedNote }),

  // .noter file opened via OS file-association
  onFileOpenRequested: (handler) => {
    const listener = (_event, data) => handler(data);
    ipcRenderer.on('file:open', listener);
    return () => ipcRenderer.removeListener('file:open', listener);
  },

  // Resource metrics (gated by debugOverlayEnabled setting)
  getAppMetrics: () => ipcRenderer.invoke('metrics:app'),

  // Multi-window: open a note in its own BrowserWindow
  openNoteInWindow: (id) => ipcRenderer.invoke('note:open-window', { id }),

  // Spell-check user dictionary
  addToUserDictionary: (word) => ipcRenderer.invoke('dictionary:add', { word }),
  removeFromUserDictionary: (word) => ipcRenderer.invoke('dictionary:remove', { word }),
  listUserDictionary: () => ipcRenderer.invoke('dictionary:list'),

  // Native file dialogs
  showOpenDialog: (opts) => ipcRenderer.invoke('dialog:open', opts),
  showSaveDialog: (opts) => ipcRenderer.invoke('dialog:save', opts),

  // Recent notes (dock-menu / Windows JumpList)
  recordRecentNote: (id, title) => ipcRenderer.invoke('recent:record', { id, title }),
  clearRecentNotes: () => ipcRenderer.invoke('recent:clear'),

  // Power events
  onPowerEvent: (handler) => {
    const events = ['power:suspend', 'power:resume', 'power:lock', 'power:unlock'];
    const listeners = events.map((evt) => {
      const listener = () => handler({ type: evt.replace('power:', '') });
      ipcRenderer.on(evt, listener);
      return { evt, listener };
    });
    return () => listeners.forEach(({ evt, listener }) => ipcRenderer.removeListener(evt, listener));
  },
});
