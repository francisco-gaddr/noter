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

  // Cold-start opens (a noter:// link / .noter file passed at launch) are drained from Rust exactly
  // once — memoised so both open-handlers share the single drain. Each subscriber then delivers only
  // the pending entries whose event matches, so nothing is lost and nothing is double-delivered.
  let pendingOpensPromise = null;
  const getPendingOpens = () => {
    if (!pendingOpensPromise) pendingOpensPromise = invoke('take_pending_opens').catch(() => []);
    return pendingOpensPromise;
  };
  const subscribeWithPending = (evt, handler) => {
    const un = on(evt, handler);
    getPendingOpens().then((list) => {
      (Array.isArray(list) ? list : []).forEach((item) => {
        if (item && item.event === evt) {
          try { handler(item.payload); } catch (_) { /* handler errors are the app's problem */ }
        }
      });
    });
    return un;
  };

  // Mirror of electron-noter/src/mlc.js extractQuant — keep in sync if that changes.
  const extractQuant = (filename) => {
    const match = String(filename || '').match(/(q\d_[0-9a-z_]+|f16|f32)/i);
    return match ? match[1].toUpperCase() : undefined;
  };

  // Find-in-page state (results are produced locally in this JS context — no Rust involved).
  const _find = { text: '', matches: 0, ordinal: 0, handlers: new Set() };
  const _countMatches = (query, matchCase) => {
    const haystackRaw = (window.document && window.document.body && window.document.body.innerText) || '';
    if (!query || !haystackRaw) return 0;
    const haystack = matchCase ? haystackRaw : haystackRaw.toLowerCase();
    const needle = matchCase ? query : query.toLowerCase();
    let count = 0;
    for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + needle.length)) count += 1;
    return count;
  };
  const _emitFindResult = () => {
    const result = { matches: _find.matches, activeMatchOrdinal: _find.ordinal, finalUpdate: true };
    _find.handlers.forEach((h) => { try { h(result); } catch (_) { /* handler errors are the app's problem */ } });
  };

  window.mlc = {
    isElectron: true, // "a native desktop bridge is present" — the UI's desktop-detection flag
    isTauri: true,
    // On-device model registry — PORTED (Rust data layer reads mlc_models/index.json). Empty until the
    // subprocess phase can install a model.
    getModels: () => invoke('mlc_get_models'),
    // Model discovery — PORTED. Pure HuggingFace HTTP (CSP allows https:), so no native code needed.
    // Shapes mirror electron-noter/src/mlc.js exactly.
    searchModels: async (query) => {
      const url = `https://huggingface.co/api/models?search=${encodeURIComponent(query)}&filter=gguf&sort=downloads&direction=-1&limit=20`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Search failed (${res.status}) ${await res.text().catch(() => '')}`);
      const data = await res.json();
      return (Array.isArray(data) ? data : []).map((m) => ({
        id: m.id,
        name: (m.id && m.id.split('/')[1]) || m.id,
        author: m.author || (m.id && m.id.split('/')[0]) || '',
        downloads: m.downloads || 0,
        likes: m.likes || 0,
        tags: m.tags || [],
      }));
    },
    getModelFiles: async (modelId) => {
      const treeUrl = `https://huggingface.co/api/models/${encodeURIComponent(modelId)}/tree/main?recursive=true`;
      const treeRes = await fetch(treeUrl);
      if (treeRes.ok) {
        const data = await treeRes.json();
        const files = Array.isArray(data) ? data : (data.tree || []);
        return files
          .filter((f) => String((f && f.path) || '').endsWith('.gguf'))
          .map((f) => ({ filename: f.path, size: f.size || 0, url: `https://huggingface.co/${modelId}/resolve/main/${f.path}`, quantization: extractQuant(f.path) }));
      }
      const modelRes = await fetch(`https://huggingface.co/api/models/${encodeURIComponent(modelId)}`);
      if (!modelRes.ok) throw new Error(`Files fetch failed (${modelRes.status}) ${await modelRes.text().catch(() => '')}`);
      const data = await modelRes.json();
      const files = Array.isArray(data && data.siblings) ? data.siblings : [];
      return files
        .filter((f) => String((f && f.rfilename) || '').endsWith('.gguf'))
        .map((f) => ({ filename: f.rfilename, size: f.size || 0, url: `https://huggingface.co/${modelId}/resolve/main/${f.rfilename}`, quantization: extractQuant(f.rfilename) }));
    },
    // Delete an installed model — PORTED (Rust removes the package dir + registry entry).
    deleteModel: (id) => invoke('mlc_delete_model', { id }),
    // Download / convert / chat need the mlc_llm subprocess — TODO(tauri): port (Phase: AI subprocess).
    downloadAndConvert: notPorted('mlc.downloadAndConvert'),
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

    // System theme — PORTED. Rust emits `theme:updated` { shouldUseDarkColors } on OS theme changes.
    onThemeChanged: (handler) => on('theme:updated', handler),

    // Auto-updater — TODO(tauri): port to tauri-plugin-updater (Phase: updater).
    checkForUpdate: () => Promise.resolve({ status: 'unsupported' }),
    installUpdateNow: () => Promise.resolve(),
    getUpdaterState: () => Promise.resolve({ status: 'idle' }),
    onUpdaterEvent: () => noop,
    onUpdaterState: () => noop,

    // Find-in-page — PORTED in pure JS on WebKit's window.find() (select-next-match) plus a text scan
    // for the match count. Results are produced locally, so onFindResult handlers are called directly
    // (no Rust round-trip). Mirrors Electron's { matches, activeMatchOrdinal } result payload.
    findStart: async (text, opts) => {
      const q = String(text || '');
      _find.text = q;
      _find.ordinal = 0;
      _find.matches = q ? _countMatches(q, !!(opts && opts.matchCase)) : 0;
      if (q && typeof window.find === 'function') {
        // collapse any previous selection so search starts from the top on a fresh find
        try { const s = window.getSelection(); if (s) s.removeAllRanges(); } catch (_) {}
        if (window.find(q, !!(opts && opts.matchCase), false, true)) _find.ordinal = 1;
      }
      _emitFindResult();
      return { requestId: 1 };
    },
    findNext: async (text, forward) => {
      const q = String(text || _find.text || '');
      if (!q || typeof window.find !== 'function') return { requestId: 1 };
      const backwards = forward === false;
      if (window.find(q, false, backwards, true) && _find.matches > 0) {
        _find.ordinal = backwards
          ? (_find.ordinal <= 1 ? _find.matches : _find.ordinal - 1)
          : (_find.ordinal >= _find.matches ? 1 : _find.ordinal + 1);
      }
      _emitFindResult();
      return { requestId: 1 };
    },
    findStop: async () => {
      _find.text = ''; _find.matches = 0; _find.ordinal = 0;
      try { const s = window.getSelection(); if (s) s.removeAllRanges(); } catch (_) {}
    },
    onFindResult: (handler) => { _find.handlers.add(handler); return () => _find.handlers.delete(handler); },

    // Notifications — PORTED (tauri-plugin-notification). Requests permission on first use.
    notify: async (payload) => {
      const n = T && T.notification;
      if (!n) return;
      try {
        let granted = await n.isPermissionGranted();
        if (!granted) granted = (await n.requestPermission()) === 'granted';
        if (granted) n.sendNotification({ title: (payload && payload.title) || 'Noter', body: (payload && payload.body) || '' });
      } catch (_) { /* notifications are best-effort */ }
    },
    // noter:// deep-link → { deeplink: route } (Rust validated the route). PORTED, incl. cold-start.
    onNoteOpenRequested: (handler) => subscribeWithPending('note:open', handler),
    setBadge: () => Promise.resolve(),

    // Drag-drop import — TODO(tauri): port (fs + drag-drop events).
    validateDroppedFiles: () => Promise.resolve([]),
    readDroppedFile: notPorted('readDroppedFile'),

    // macOS share menu / Touch Bar — TODO(tauri): port (macOS only).
    openShareMenu: () => Promise.resolve(),
    setTouchBar: () => Promise.resolve(),
    onTouchBarAction: () => noop,

    // Print — PORTED via the webview's own print dialog. The lock invariant is preserved: a locked
    // note is NEVER printed (mirrors Electron's { ok:false, reason:'note-is-locked' } guard).
    // print-to-pdf needs native PDF generation Tauri lacks out-of-box → still a stub (no fake dataUrl).
    printNote: async (_options, lockedNote) => {
      if (lockedNote === true) return { ok: false, reason: 'note-is-locked' };
      try { window.print(); return { ok: true }; } catch (e) { return { ok: false, reason: e && e.message }; }
    },
    printNoteToPdf: notPorted('printNoteToPdf'),
    openPrintPreview: notPorted('openPrintPreview'),

    // .noter file opened via OS file-association → { path }. PORTED, incl. cold-start launch.
    onFileOpenRequested: (handler) => subscribeWithPending('file:open', handler),

    // Metrics — TODO(tauri): port.
    getAppMetrics: () => Promise.resolve(null),

    // Multi-window — PORTED: Rust opens a new window with the same bridge and delivers the note route
    // through that window's own pending-opens queue (no race with this window).
    openNoteInWindow: (id) => invoke('open_note_window', { id }),

    // Spell-check user dictionary — TODO(tauri): port.
    addToUserDictionary: () => Promise.resolve(),
    removeFromUserDictionary: () => Promise.resolve(),
    listUserDictionary: () => Promise.resolve([]),

    // Native dialogs — PORTED (tauri-plugin-dialog). Electron opts are adapted to Tauri's shape and
    // the result is adapted back to Electron's { canceled, filePaths|filePath } so the UI is unchanged.
    showOpenDialog: async (opts) => {
      const d = T && T.dialog;
      if (!d) return { canceled: true, filePaths: [] };
      const o = opts || {};
      const props = Array.isArray(o.properties) ? o.properties : [];
      const res = await d.open({
        multiple: props.includes('multiSelections'),
        directory: props.includes('openDirectory'),
        filters: o.filters,
        defaultPath: o.defaultPath,
        title: o.title,
      });
      const paths = res == null ? [] : Array.isArray(res) ? res : [res];
      return { canceled: paths.length === 0, filePaths: paths };
    },
    showSaveDialog: async (opts) => {
      const d = T && T.dialog;
      if (!d) return { canceled: true, filePath: undefined };
      const o = opts || {};
      const res = await d.save({ filters: o.filters, defaultPath: o.defaultPath, title: o.title });
      return { canceled: res == null, filePath: res || undefined };
    },

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
