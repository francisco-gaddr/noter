// Tauri preload bridge — re-creates the window.mlc + window.noterDesktop API the shared Next.js UI
// depends on, backed by Tauri invoke()/listen() instead of Electron ipcRenderer. Injected as the
// window's initialization script so it runs BEFORE the app loads.
//
// Migration status: ported channels call Rust; channels not yet ported return a SAFE default (no-op,
// null, or a rejected promise with a clear message) so the UI degrades gracefully instead of crashing.
// Each is tagged `// TODO(tauri): port` so the remaining work is greppable.
(function () {
  'use strict';
  const T = window.__TAURI__;
  const invoke = (cmd, args) =>
    T && T.core && T.core.invoke ? T.core.invoke(cmd, args) : Promise.reject(new Error('Tauri bridge unavailable'));
  const listen = (evt, cb) =>
    T && T.event && T.event.listen ? T.event.listen(evt, (e) => cb(e.payload)) : Promise.resolve(() => {});
  // Subscribe helper returning a synchronous unsubscribe (Electron preload contract).
  const on = (evt, handler) => {
    let un = () => {};
    listen(evt, handler).then((u) => { un = u; });
    return () => un();
  };
  const notPorted = (name) => () => Promise.reject(new Error(`"${name}" is not available yet in the Tauri build (being ported).`));
  const noop = () => {};

  window.mlc = {
    isElectron: true, // "a native desktop bridge is present" — the UI's desktop-detection flag
    isTauri: true,
    // On-device model manager — TODO(tauri): port the mlc subprocess bridge (Phase: AI).
    getModels: notPorted('mlc.getModels'),
    searchModels: notPorted('mlc.searchModels'),
    getModelFiles: notPorted('mlc.getModelFiles'),
    downloadAndConvert: notPorted('mlc.downloadAndConvert'),
    deleteModel: notPorted('mlc.deleteModel'),
    chat: notPorted('mlc.chat'),
    cancelChat: () => Promise.resolve(),
    onDownloadProgress: () => noop,
    onChatToken: () => noop,
    // Settings — PORTED.
    getSetting: (key) => invoke('settings_get', { key }),
    setSetting: (key, value) => invoke('settings_set', { key, value }),
  };

  window.noterDesktop = {
    isElectron: true,
    isTauri: true,

    // Secure secret store — PORTED (OS keychain via the keyring crate).
    secureStatus: () => invoke('secure_status'),
    secureGet: (key) => invoke('secure_get', { key }),
    secureSet: (key, value) => invoke('secure_set', { key, value }),
    secureDelete: (key) => invoke('secure_delete', { key }),
    secureClear: () => invoke('secure_clear'),

    // Settings-flip preferences — PORTED (persisted; OS-level effects wired in later phases).
    setOpenAtLogin: (enabled) => invoke('settings_set', { key: 'openAtLogin', value: enabled === true }),
    setTrayOnly: (enabled) => invoke('settings_set', { key: 'trayOnly', value: enabled === true }),
    setSpellCheckerCdn: (url) => invoke('settings_set', { key: 'spellCheckerCdn', value: typeof url === 'string' ? url : null }),

    // System theme — TODO(tauri): port via window theme events.
    onThemeChanged: () => noop,

    // Auto-updater — TODO(tauri): port to tauri-plugin-updater (Phase: updater).
    checkForUpdate: () => Promise.resolve({ status: 'unsupported' }),
    installUpdateNow: () => Promise.resolve(),
    getUpdaterState: () => Promise.resolve({ status: 'idle' }),
    onUpdaterEvent: () => noop,
    onUpdaterState: () => noop,

    // Find-in-page — TODO(tauri): port (webview find API).
    findStart: notPorted('findStart'),
    findNext: notPorted('findNext'),
    findStop: () => Promise.resolve(),
    onFindResult: () => noop,

    // Notifications — TODO(tauri): port to tauri-plugin-notification.
    notify: notPorted('notify'),
    onNoteOpenRequested: () => noop,
    setBadge: () => Promise.resolve(),

    // Drag-drop import — TODO(tauri): port (fs + drag-drop events).
    validateDroppedFiles: () => Promise.resolve([]),
    readDroppedFile: notPorted('readDroppedFile'),

    // macOS share menu / Touch Bar — TODO(tauri): port (macOS only).
    openShareMenu: () => Promise.resolve(),
    setTouchBar: () => Promise.resolve(),
    onTouchBarAction: () => noop,

    // Print — TODO(tauri): port (webview print / print-to-pdf).
    printNote: notPorted('printNote'),
    printNoteToPdf: notPorted('printNoteToPdf'),
    openPrintPreview: notPorted('openPrintPreview'),

    // File association open — TODO(tauri): port to tauri-plugin-deep-link + file-open events.
    onFileOpenRequested: () => noop,

    // Metrics — TODO(tauri): port.
    getAppMetrics: () => Promise.resolve(null),

    // Multi-window — TODO(tauri): port (Tauri multi-window).
    openNoteInWindow: notPorted('openNoteInWindow'),

    // Spell-check user dictionary — TODO(tauri): port.
    addToUserDictionary: () => Promise.resolve(),
    removeFromUserDictionary: () => Promise.resolve(),
    listUserDictionary: () => Promise.resolve([]),

    // Native dialogs — TODO(tauri): port to tauri-plugin-dialog.
    showOpenDialog: notPorted('showOpenDialog'),
    showSaveDialog: notPorted('showSaveDialog'),

    // Recent notes (dock/JumpList) — TODO(tauri): port.
    recordRecentNote: () => Promise.resolve(),
    clearRecentNotes: () => Promise.resolve(),

    // Power events — TODO(tauri): port.
    onPowerEvent: () => noop,

    // Search thumbnails / isolated DOM ops — TODO(tauri): port.
    createThumbnail: notPorted('createThumbnail'),
    runIsolatedScript: notPorted('runIsolatedScript'),
  };
})();
