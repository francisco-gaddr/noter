const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen, nativeTheme, shell, crashReporter, dialog, clipboard, Notification, powerMonitor, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { getModels, downloadAndConvert, deleteModel, runChat, cancelChat, searchModels, getModelFiles } = require('./src/mlc');
const { buildAppMenuTemplate } = require('./src/appMenu');
const { buildContextMenuTemplate } = require('./src/contextMenu');
const { pushRecent, buildRecentMenuTemplate } = require('./src/recentNotes');
const { parseDeeplink, findDeeplinkInArgv } = require('./src/deeplink');
const { validateDroppedFile } = require('./src/dragDrop');
const { validateSharePayload, hasShareablePayload } = require('./src/sharePayload');
const { createRecoveryPolicy } = require('./src/crashRecovery');
const { buildTouchBarTemplate, isValidContext: isValidTouchBarContext } = require('./src/touchBar');
const { validatePrintOptions } = require('./src/printOptions');
const { buildNoteWindowOptions } = require('./src/noteWindow');
const { addWord: addUserDictWord, removeWord: removeUserDictWord, reconcileWords: reconcileUserDictWords } = require('./src/userDictionary');
const { validateOpenDialogOptions, validateSaveDialogOptions } = require('./src/fileDialog');
const { validateNoterFilePath, extractOpenFilePathFromArgv } = require('./src/fileAssociation');
const { getDragFeedbackCss } = require('./src/dragFeedback');
const { buildPreviewHtml, previewWindowOptions } = require('./src/printPreview');
const { resolveVibrancyForTheme, isValidVibrancyMaterial } = require('./src/vibrancy');
const { resolveBackgroundPolicy, intervalMultiplier } = require('./src/batteryPolicy');
const { createUpdaterStateMachine } = require('./src/updaterStatus');
const { validateWindowState, captureWindowState, DEFAULTS: WINDOW_DEFAULTS } = require('./src/windowState');
const { createSecureStore } = require('./src/secureStore');

// ---------- single-instance lock (must run BEFORE app.whenReady) ----------
//
// Without this, double-clicking the dock icon (macOS) or launching the
// shortcut twice (Windows) spawns a second backend process — confusing
// for the user and dangerous for the local model state in src/mlc.
//
// `requestSingleInstanceLock` returns true for the FIRST instance. A
// second instance hits the lock, fires the 'second-instance' event on
// the first instance with its argv, and immediately quits itself.
const gotSingleInstanceLock = process.env.ELECTRON_TEST === '1' ? true : app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv, _cwd) => {
    // Focus the existing window so the user sees the result of their click.
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
    // If the second-instance argv carries a noter:// deeplink, route to it.
    const link = findDeeplinkInArgv(argv);
    if (link && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('note:open', { deeplink: link.route });
    }
  });
}

// ---------- protocol registration ----------
// Tell the OS we handle `noter://` URLs. On macOS the 'open-url' event below
// fires; on Windows/Linux deeplinks come in as a process argv entry that the
// 'second-instance' handler picks up.
if (process.defaultApp) {
  // dev mode: command-line invocation differs.
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('noter', process.execPath, [require('path').resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient('noter');
}

app.on('open-url', (event, url) => {
  // macOS hits this when the user clicks a noter:// link.
  event.preventDefault();
  const link = parseDeeplink(url);
  if (!link) return;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send('note:open', { deeplink: link.route });
  }
});

// macOS: user double-clicked a .noter file in Finder while we're already running.
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  if (!validateNoterFilePath(filePath)) return;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.send('file:open', { path: filePath });
  } else {
    // Stash for after the window mounts.
    pendingOpenFilePath = filePath;
  }
});

// Stash for a .noter file passed at launch (Windows/Linux argv).
let pendingOpenFilePath = extractOpenFilePathFromArgv(process.argv);

// ---------- command-line switches (must run BEFORE app.whenReady) ----------
// Disable OutOfBlinkCors only when explicitly opted-in via env. The default
// chromium CORS implementation lives outside Blink and occasionally surfaces
// edge-cases with our auth flow on Windows; we keep this as an escape hatch
// rather than a default so we don't weaken the renderer's security posture.
if (process.env.NOTER_DISABLE_OUT_OF_BLINK_CORS === '1') {
  try { app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors'); } catch { /* noop */ }
}
// Force colored emoji rendering on Linux/Win for visual consistency.
try { app.commandLine.appendSwitch('enable-features', 'CalculateNativeWinOcclusion'); } catch { /* noop */ }

const isDev = process.env.NODE_ENV === 'development';
const isTest = process.env.ELECTRON_TEST === '1';
const devUrl = 'http://localhost:3001/';
const remoteUrl = 'https://daylited.com/';
const userDataDir = process.env.ELECTRON_USER_DATA_DIR;
const settingsFileName = 'settings.json';
const rendererFallbackUrls = Array.from(new Set([
  process.env.ELECTRON_RENDERER_URL,
  'http://localhost:3001/app/',
  devUrl,
  'http://127.0.0.1:3001/',
  'http://127.0.0.1:3001/app/',
  'https://daylited.com/app/',
  remoteUrl,
].filter(Boolean)));

if (userDataDir) {
  app.setPath('userData', userDataDir);
}

// ---------- settings ----------
const readSettings = () => {
  try {
    const filePath = path.join(app.getPath('userData'), settingsFileName);
    if (!fs.existsSync(filePath)) return {};
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
};

const writeSettings = (next) => {
  const filePath = path.join(app.getPath('userData'), settingsFileName);
  fs.writeFileSync(filePath, JSON.stringify(next, null, 2));
};

const updateSetting = (key, value) => {
  const settings = readSettings();
  if (value === null || value === undefined) delete settings[key];
  else settings[key] = value;
  writeSettings(settings);
  return settings;
};

// ---------- platform detection ----------
const isWindows11 = () => {
  if (process.platform !== 'win32') return false;
  // Windows 11 reports as version 10.0.22000+ via os.release().
  try {
    const parts = os.release().split('.').map((v) => parseInt(v, 10));
    if (parts.length < 3) return false;
    if (parts[0] > 10) return true;
    if (parts[0] === 10 && parts[2] >= 22000) return true;
    return false;
  } catch {
    return false;
  }
};

// ---------- tray ----------
let tray = null;
let mainWindow = null;

const ensureTrayIcon = () => {
  // Use a 1x1 transparent placeholder when no icon asset is present.
  // Production should ship a real PNG under build/icons/tray.png.
  const candidates = [
    path.join(__dirname, 'build', 'icons', 'tray.png'),
    path.join(__dirname, 'build', 'icon.png'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return nativeImage.createFromPath(p);
  }
  return nativeImage.createEmpty();
};

const showMainWindow = () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createWindow();
  }
  mainWindow.show();
  mainWindow.focus();
};

const buildTrayMenu = () => Menu.buildFromTemplate([
  { label: 'Open Noter', click: () => showMainWindow() },
  { type: 'separator' },
  {
    label: 'Open at login',
    type: 'checkbox',
    checked: readSettings().openAtLogin === true,
    click: (item) => applyLoginItemPreference(item.checked === true),
  },
  {
    label: 'Tray-only (hide Dock)',
    type: 'checkbox',
    visible: process.platform === 'darwin',
    checked: readSettings().trayOnly === true,
    click: (item) => applyTrayOnlyMode(item.checked === true),
  },
  { type: 'separator' },
  { role: 'quit' },
]);

const createTray = () => {
  if (tray) return tray;
  tray = new Tray(ensureTrayIcon());
  tray.setToolTip('Noter');
  tray.on('click', () => showMainWindow());
  // Cursor-anchored context menu: Electron natively positions the menu near
  // the tray icon on macOS/Windows, but on multi-monitor setups it can land
  // on the wrong display. Anchoring to screen.getCursorScreenPoint() pins it
  // to the user's actual mouse position regardless of display layout.
  tray.on('right-click', () => {
    const cursor = screen.getCursorScreenPoint();
    tray.popUpContextMenu(buildTrayMenu(), { x: cursor.x, y: cursor.y });
  });
  return tray;
};

// ---------- login-at-startup (opt-in) ----------
const applyLoginItemPreference = (enabled) => {
  // Per Electron docs we must NEVER call setLoginItemSettings(true) implicitly;
  // it counts as auto-launch and many platforms (notably macOS) ask the user to
  // approve it. We only flip the OS flag when the user explicitly toggles the UI.
  updateSetting('openAtLogin', enabled === true);
  if (process.platform === 'darwin' || process.platform === 'win32') {
    try {
      app.setLoginItemSettings({
        openAtLogin: enabled === true,
        openAsHidden: enabled === true,
      });
    } catch (err) {
      console.warn('[startup] setLoginItemSettings failed:', err && err.message);
    }
  }
  refreshTrayMenu();
};

const reconcileLoginItemOnBoot = () => {
  // On boot, sync OS state with stored preference. If the user previously opted
  // in, restore it; otherwise ensure it stays off in case it was set out-of-band.
  const desired = readSettings().openAtLogin === true;
  if (process.platform === 'darwin' || process.platform === 'win32') {
    try {
      const current = app.getLoginItemSettings();
      if (current.openAtLogin !== desired) {
        app.setLoginItemSettings({ openAtLogin: desired, openAsHidden: desired });
      }
    } catch {
      // ignore: not all platforms support this
    }
  }
};

// ---------- accessory (tray-only) policy ----------
const applyTrayOnlyMode = (enabled) => {
  updateSetting('trayOnly', enabled === true);
  if (process.platform !== 'darwin') return;
  try {
    // setActivationPolicy('accessory') hides the Dock icon entirely; 'regular'
    // restores it. We don't call it on non-darwin (it's a no-op there but the
    // signature is darwin-only).
    app.setActivationPolicy(enabled ? 'accessory' : 'regular');
  } catch (err) {
    console.warn('[accessory] setActivationPolicy failed:', err && err.message);
  }
  refreshTrayMenu();
};

const refreshTrayMenu = () => {
  if (!tray) return;
  tray.setContextMenu(buildTrayMenu());
};

// ---------- spell-checker dictionary CDN pinning ----------
const applySpellCheckerCdn = (session) => {
  // Default Electron pulls Hunspell dictionaries from Google's CDN. We pin to
  // our own CDN when configured so the supply chain is auditable. The URL must
  // end with `/` per Electron's API contract.
  const settings = readSettings();
  const fromSetting = typeof settings.spellCheckerCdn === 'string' ? settings.spellCheckerCdn : '';
  const fromEnv = typeof process.env.SPELLCHECK_DICT_CDN === 'string' ? process.env.SPELLCHECK_DICT_CDN : '';
  const raw = (fromSetting || fromEnv || '').trim();
  if (!raw) return;
  try {
    const normalized = raw.endsWith('/') ? raw : `${raw}/`;
    const url = new URL(normalized);
    if (url.protocol !== 'https:') {
      console.warn('[spellcheck] CDN must be https, ignoring:', normalized);
      return;
    }
    session.setSpellCheckerDictionaryDownloadURL(normalized);
  } catch (err) {
    console.warn('[spellcheck] invalid CDN URL:', err && err.message);
  }
};

// ---------- reduced-motion CSS ----------
const REDUCED_MOTION_CSS = `
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
    scroll-behavior: auto !important;
  }
}
`;

const applyReducedMotion = async (webContents) => {
  // We always inject the CSS — the @media query itself respects the OS pref.
  // Sending an inserted-CSS key would let us toggle it later, but here we only
  // want it to "always be ready"; the OS controls whether it applies.
  try {
    await webContents.insertCSS(REDUCED_MOTION_CSS);
  } catch (err) {
    console.warn('[reduced-motion] insertCSS failed:', err && err.message);
  }
};

// ---------- isolated-world DOM helpers ----------
// Renderer code that needs to mutate the DOM from main goes through this IPC
// path. executeJavaScriptInIsolatedWorld keeps the script out of the page's
// main world, so it cannot be observed/intercepted by page scripts and our CSP
// for the page stays untouched. We only allow registered scripts.
const ISOLATED_WORLD_ID = 999;
const ALLOWED_ISOLATED_SCRIPTS = new Map([
  ['highlight-search', (term) => {
    if (typeof term !== 'string' || term.length === 0) return 'noop';
    // Simple safe highlight; uses textContent only, no innerHTML to avoid XSS.
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

const runIsolatedScript = async (webContents, scriptKey, arg) => {
  const factory = ALLOWED_ISOLATED_SCRIPTS.get(scriptKey);
  if (!factory) throw new Error(`unknown isolated script: ${scriptKey}`);
  const source = factory(arg);
  return webContents.executeJavaScriptInIsolatedWorld(ISOLATED_WORLD_ID, [
    { code: source },
  ]);
};

// ---------- error/recovery loading (unchanged behaviour) ----------
const errorScreenPath = path.join(__dirname, 'renderer', 'error.html');

const isUrlReachable = async (url) => {
  try {
    const res = await fetch(url, { method: 'GET', redirect: 'manual' });
    return res.ok || (res.status >= 300 && res.status < 400);
  } catch {
    return false;
  }
};

const loadFirstReachableUrl = async (win) => {
  for (const url of rendererFallbackUrls) {
    if (win.isDestroyed()) return false;
    const reachable = await isUrlReachable(url);
    if (!reachable) continue;
    try {
      await win.loadURL(url);
      return true;
    } catch {
      // try next
    }
  }
  return false;
};

const createWindow = () => {
  // Restore window state from settings, validated against the current display
  // layout so we never restore off-screen when an external monitor is gone.
  const displays = (screen && typeof screen.getAllDisplays === 'function') ? screen.getAllDisplays() : [];
  const restoredState = validateWindowState(readSettings().windowState, displays);

  const win = new BrowserWindow({
    width: restoredState.width || WINDOW_DEFAULTS.width,
    height: restoredState.height || WINDOW_DEFAULTS.height,
    ...(Number.isFinite(restoredState.x) ? { x: restoredState.x } : {}),
    ...(Number.isFinite(restoredState.y) ? { y: restoredState.y } : {}),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      // Explicit OS-level renderer sandbox. The preload uses only contextBridge +
      // ipcRenderer (no Node primitives), so sandboxing is safe and closes the
      // V8/Chromium attack surface. Explicit > relying on the Electron default.
      sandbox: true,
      // Defence-in-depth: block loading non-local/insecure resources.
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      spellcheck: true,
      // DevTools gate: never allow opening DevTools in production builds.
      // The View menu honours the same flag (see appMenu.js) but webContents
      // can also be opened via keyboard shortcuts and the inspector protocol
      // — disabling it here closes the loophole entirely.
      devTools: isDev,
    },
  });

  if (restoredState.isMaximized) {
    win.maximize();
  }

  // Persist window bounds when the user resizes/moves. Throttle to once per
  // 500ms via a trailing timeout so we don't write the settings file on every
  // pixel of a resize drag.
  let savePending = null;
  const queueSave = () => {
    if (savePending) clearTimeout(savePending);
    savePending = setTimeout(() => {
      const next = captureWindowState(win);
      if (next) updateSetting('windowState', next);
    }, 500);
  };
  win.on('resize', queueSave);
  win.on('move', queueSave);
  win.on('maximize', queueSave);
  win.on('unmaximize', queueSave);

  // Defense in depth: even with devTools:false above, paranoid coverage of any
  // way to open the inspector. In production we close DevTools on every attempt.
  if (!isDev) {
    win.webContents.on('devtools-opened', () => {
      try { win.webContents.closeDevTools(); } catch { /* noop */ }
    });
  }

  // Renderer crash recovery. We tolerate a small number of crashes within a
  // sliding window (auto-reload silently) then escalate to a user dialog
  // before the n+1th attempt. The policy lives in src/crashRecovery.js so
  // it's pure-testable.
  const recovery = createRecoveryPolicy();
  win.webContents.on('render-process-gone', (_event, details) => {
    console.warn('[crash-recovery] renderer gone:', details && details.reason);
    const decision = recovery.recordCrash(details?.reason);
    if (decision.action === 'ignore') return;
    if (decision.action === 'reload') {
      try { win.reload(); } catch (err) { console.warn('[crash-recovery] reload failed:', err && err.message); }
      return;
    }
    // decision.action === 'prompt'
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      title: 'Noter has crashed repeatedly',
      message: 'The renderer has crashed multiple times in the last few minutes.',
      detail: 'Would you like to keep trying or quit?',
      buttons: ['Try Again', 'Quit'],
      defaultId: 0,
      cancelId: 1,
    });
    if (choice === 0) {
      recovery.reset();
      try { win.reload(); } catch { /* noop */ }
    } else {
      app.quit();
    }
  });

  // Apply Windows 11 acrylic if available. setBackgroundMaterial is a no-op on
  // platforms/versions that don't support it; we wrap defensively because older
  // Electron didn't have the API at all.
  if (isWindows11() && typeof win.setBackgroundMaterial === 'function') {
    try {
      win.setBackgroundMaterial('acrylic');
    } catch (err) {
      console.warn('[acrylic] setBackgroundMaterial failed:', err && err.message);
    }
  }

  // macOS vibrancy — picks the right NSVisualEffectView material for
  // the current theme. No-op on non-darwin.
  if (process.platform === 'darwin' && typeof win.setVibrancy === 'function') {
    const theme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
    const material = resolveVibrancyForTheme(theme);
    if (material && isValidVibrancyMaterial(material)) {
      try { win.setVibrancy(material); } catch (err) {
        console.warn('[vibrancy] setVibrancy failed:', err && err.message);
      }
    }
  }

  // Pin the User-Agent so backend can detect us as the Noter desktop client
  // (used for telemetry tagging and to silence "unknown browser" rate-limits).
  // We append rather than replace so Chromium's default UA-CH headers still go
  // through and we don't break detect-via-fingerprint backends.
  try {
    const ua = `${win.webContents.session.getUserAgent()} NoterDesktop/${app.getVersion()} (${process.platform})`;
    win.webContents.session.setUserAgent(ua);
  } catch (err) {
    console.warn('[ua] setUserAgent failed:', err && err.message);
  }

  applySpellCheckerCdn(win.webContents.session);
  // Replay any user-added dictionary words so they're recognised by the
  // native spell-checker in this window.
  reconcileSpellCheckerDictionary(win.webContents.session);

  win.once('ready-to-show', () => {
    if (readSettings().startMinimized === true || (process.platform === 'darwin' && readSettings().trayOnly === true)) {
      // tray-only mode: don't show the main window on launch
      return;
    }
    win.show();
  });

  win.webContents.on('did-finish-load', () => {
    void applyReducedMotion(win.webContents);
    // Inject the drag-target highlight CSS so the renderer's drop zone
    // gets a clean visual when files are hovered over the window.
    try { win.webContents.insertCSS(getDragFeedbackCss()); } catch { /* noop */ }
    // If a .noter file was passed on the CLI before the window existed,
    // deliver it now.
    if (pendingOpenFilePath) {
      const filePath = pendingOpenFilePath;
      pendingOpenFilePath = null;
      win.webContents.send('file:open', { path: filePath });
    }
  });

  // Force external links to open in the OS browser, not a new BrowserWindow.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  // Right-click context menu. We build a fresh template per event so options
  // reflect the user's selection / link / image at the moment of click.
  win.webContents.on('context-menu', (_event, params) => {
    const template = buildContextMenuTemplate(params, {
      isDev,
      on: {
        openExternal: (url) => shell.openExternal(url),
        writeClipboard: (text) => clipboard.writeText(text),
        find: (term) => {
          if (typeof term === 'string' && term.length > 0) {
            win.webContents.findInPage(term);
          }
        },
        inspectElement: (x, y) => {
          if (isDev) win.webContents.inspectElement(x, y);
        },
      },
    });
    if (template.length > 0) {
      Menu.buildFromTemplate(template).popup({ window: win });
    }
  });

  // Find-in-page state. The renderer can drive it via IPC (handlers further
  // down) and we forward result events back so the search bar can show
  // "match 3 of 12".
  win.webContents.on('found-in-page', (_event, result) => {
    win.webContents.send('find:result', result);
  });

  if (isTest) {
    win.loadFile(path.join(__dirname, 'renderer', 'test.html'));
    return win;
  }

  const rendererIndex = path.join(__dirname, 'renderer', 'app', 'index.html');
  let recovering = false;
  const recoverRenderer = async () => {
    if (recovering || win.isDestroyed()) return;
    recovering = true;
    try {
      await win.loadFile(errorScreenPath);
      const loaded = await loadFirstReachableUrl(win);
      if (!loaded && !win.isDestroyed()) {
        await win.loadFile(errorScreenPath);
      }
    } finally {
      recovering = false;
    }
  };

  if (isDev) {
    win.loadURL(devUrl);
  } else if (fs.existsSync(rendererIndex)) {
    win.loadFile(rendererIndex);
  } else {
    recoverRenderer();
  }

  win.webContents.on('did-fail-load', () => {
    recoverRenderer();
  });

  win.on('focus', () => {
    // Clear the dock/launcher badge when the user is actively looking at
    // the app — convention from native macOS apps.
    try {
      if (process.platform === 'darwin' && typeof app.setBadgeCount === 'function') {
        app.setBadgeCount(0);
      } else if (process.platform === 'darwin' && app.dock?.setBadge) {
        app.dock.setBadge('');
      } else if (process.platform === 'linux' && typeof app.setBadgeCount === 'function') {
        app.setBadgeCount(0);
      }
    } catch { /* noop */ }
  });

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });

  return win;
};

// ---------- thumbnail generation for instant search ----------
const generateThumbnail = async (filePath, size) => {
  if (typeof filePath !== 'string' || filePath.length === 0) {
    throw new Error('filePath required');
  }
  const resolved = path.resolve(filePath);
  // Restrict to userData or downloads to prevent arbitrary FS reads via IPC.
  const safeRoots = [
    app.getPath('userData'),
    app.getPath('downloads'),
    app.getPath('pictures'),
    app.getPath('documents'),
  ];
  const allowed = safeRoots.some((root) => {
    try { return resolved.startsWith(path.resolve(root) + path.sep); } catch { return false; }
  });
  if (!allowed) {
    throw new Error('thumbnail: path outside allowed roots');
  }
  if (!fs.existsSync(resolved)) {
    throw new Error('thumbnail: file not found');
  }
  const target = {
    width: Math.max(16, Math.min(Number(size && size.width) || 128, 512)),
    height: Math.max(16, Math.min(Number(size && size.height) || 128, 512)),
  };
  try {
    const thumb = await nativeImage.createThumbnailFromPath(resolved, target);
    return thumb.toDataURL();
  } catch (err) {
    // createThumbnailFromPath isn't supported for every file type — fall back
    // to a regular file-read path that lets nativeImage decode it itself.
    const fallback = nativeImage.createFromPath(resolved);
    if (fallback.isEmpty()) throw err;
    return fallback.resize(target).toDataURL();
  }
};

// ---------- crashReporter (pinned endpoint, opt-in) ----------
//
// We never enable crash uploads automatically. The renderer can flip this via
// settings.json (`crashReportsEnabled: true`) AND provide a `crashSubmitUrl`.
// When both conditions are met we start the reporter pointing at a self-hosted
// minidump receiver — NOT Sentry, NOT a 3rd-party SaaS — so crash binaries
// never leave infrastructure we control.
const setupCrashReporter = () => {
  const settings = readSettings();
  if (settings.crashReportsEnabled !== true) return;
  const submitURL = typeof settings.crashSubmitUrl === 'string' ? settings.crashSubmitUrl.trim() : '';
  if (!submitURL) return;
  try {
    const url = new URL(submitURL);
    if (url.protocol !== 'https:') {
      console.warn('[crashReporter] submitURL must be https, skipping');
      return;
    }
    crashReporter.start({
      productName: 'Noter',
      companyName: 'Noter',
      submitURL,
      uploadToServer: true,
      ignoreSystemCrashHandler: false,
      compress: true,
      // Tag the minidump with the running version so we can correlate to release.
      extra: { app_version: app.getVersion(), os: process.platform, channel: settings.updateChannel || 'stable' },
    });
  } catch (err) {
    console.warn('[crashReporter] start failed:', err && err.message);
  }
};

// ---------- electron-updater scaffold (auto-check + apply-restart) ----------
//
// Behaviour:
//   - On boot, check for updates after a 30s warm-up so it doesn't compete with
//     window-painting/network-warming.
//   - Re-check every 6h while the app runs.
//   - When an update is downloaded, prompt the user (don't auto-apply).
//   - Sigstore-verification of the downloaded asset is gated behind
//     NOTER_UPDATE_VERIFY_SIGSTORE=1 — without a release pipeline that publishes
//     cosign signatures, enabling it would break updates. The plumbing is here
//     so flipping the flag once the pipeline ships is a one-line change.
let _autoUpdater = null;
const getAutoUpdater = () => {
  if (_autoUpdater) return _autoUpdater;
  try {
    // eslint-disable-next-line global-require
    const mod = require('electron-updater');
    _autoUpdater = mod && mod.autoUpdater ? mod.autoUpdater : null;
  } catch {
    _autoUpdater = null;
  }
  return _autoUpdater;
};

const verifyUpdateSignatureStub = async (filePath) => {
  // Placeholder for cosign verify-blob. When NOTER_UPDATE_VERIFY_SIGSTORE=1
  // the actual implementation should:
  //  1. Fetch the matching .sig + .crt from the release artifacts.
  //  2. Run `cosign verify-blob --certificate-identity-regexp ...` against the
  //     downloaded binary and reject the update if the signer SAN doesn't
  //     match our allow-list (same allow-list as the rekor-audit workflow).
  // Until the release pipeline emits these, we no-op and log.
  if (process.env.NOTER_UPDATE_VERIFY_SIGSTORE !== '1') return { ok: true, skipped: true };
  console.warn('[updater] Sigstore verification enabled but no implementation wired; refusing update for safety:', filePath);
  return { ok: false, error: 'sigstore-verify-not-implemented' };
};

const setupAutoUpdater = () => {
  const updater = getAutoUpdater();
  if (!updater) {
    console.log('[updater] electron-updater not installed; auto-update disabled');
    return;
  }
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = false;

  updater.on('checking-for-update', () => dispatchUpdaterEvent({ type: 'checking' }));
  updater.on('update-available', (info) => {
    broadcast('updater:available', info);
    dispatchUpdaterEvent({ type: 'available', data: { version: info?.version } });
  });
  updater.on('update-not-available', () => {
    broadcast('updater:not-available');
    dispatchUpdaterEvent({ type: 'not-available' });
  });
  updater.on('error', (err) => {
    console.warn('[updater] error:', err && err.message);
    broadcast('updater:error', { message: err && err.message });
    dispatchUpdaterEvent({ type: 'error', data: { message: err?.message } });
  });
  updater.on('download-progress', (progress) => {
    broadcast('updater:progress', progress);
    dispatchUpdaterEvent({ type: 'progress', data: progress });
  });
  updater.on('update-downloaded', async (info) => {
    const downloadPath = info && info.downloadedFile;
    const verification = await verifyUpdateSignatureStub(downloadPath);
    if (!verification.ok) {
      broadcast('updater:rejected', { reason: verification.error || 'unknown' });
      dispatchUpdaterEvent({ type: 'rejected', data: { reason: verification.error || 'unknown' } });
      return;
    }
    broadcast('updater:ready', { version: info && info.version });
    dispatchUpdaterEvent({ type: 'ready', data: { version: info?.version } });
  });

  // Battery-aware checker. We respect the resolved background policy:
  // 'paused' means don't even try a check. The base interval is 6h on AC;
  // on battery we slow down via intervalMultiplier.
  const baseIntervalMs = 6 * 60 * 60 * 1000;
  const maybeCheck = () => {
    const policy = evaluatePowerPolicy();
    if (policy.policy === 'paused') {
      console.log('[updater] skipping check:', policy.reason);
      return;
    }
    try { updater.checkForUpdates(); } catch (err) { console.warn('[updater] check failed:', err && err.message); }
  };

  setTimeout(maybeCheck, 30_000);
  const reschedule = () => {
    const policy = evaluatePowerPolicy();
    const mult = intervalMultiplier(policy.policy);
    const ms = Number.isFinite(mult) ? baseIntervalMs * mult : baseIntervalMs * 4; // 'paused' falls back to "very rarely"
    setTimeout(() => { maybeCheck(); reschedule(); }, ms);
  };
  reschedule();
};

// ---------- native notifications ----------
//
// We wrap Notification so the renderer doesn't have direct access to the
// Notification class (would need nodeIntegration to construct it). The
// renderer dispatches { title, body, deeplink } via IPC and we create the
// notification here. Clicks deliver `note:open` to the focused window with
// the deeplink target.
const showNativeNotification = ({ title, body, deeplink, silent }) => {
  try {
    if (typeof Notification === 'undefined' || !Notification.isSupported()) return false;
    const n = new Notification({
      title: String(title || 'Noter').slice(0, 80),
      body: String(body || '').slice(0, 200),
      silent: silent === true,
    });
    n.on('click', () => {
      showMainWindow();
      if (mainWindow && !mainWindow.isDestroyed() && typeof deeplink === 'string' && deeplink.length > 0) {
        mainWindow.webContents.send('note:open', { deeplink });
      }
    });
    n.show();
    return true;
  } catch (err) {
    console.warn('[notification] failed:', err && err.message);
    return false;
  }
};

// ---------- powerMonitor (suspend/resume) ----------
//
// On laptop sleep we tell the renderer to flush pending state so the user
// doesn't lose unsaved edits on a crash-during-sleep. On resume we kick a
// resync. We intentionally don't pre-empt the renderer mid-write — just
// signal it; it owns the actual flush logic.
const setupPowerMonitor = () => {
  try {
    powerMonitor.on('suspend', () => {
      broadcast('power:suspend');
    });
    powerMonitor.on('resume', () => {
      broadcast('power:resume');
    });
    powerMonitor.on('lock-screen', () => {
      broadcast('power:lock');
    });
    powerMonitor.on('unlock-screen', () => {
      broadcast('power:unlock');
    });
  } catch (err) {
    console.warn('[powerMonitor] setup failed:', err && err.message);
  }
};

// ---------- recent notes (dock menu / jumplist) ----------
const refreshRecentNotesMenu = () => {
  const list = readSettings().recentNotes || [];
  const template = buildRecentMenuTemplate(list, {
    onOpen: (id) => {
      showMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('note:open', { deeplink: `/note/${id}` });
      }
    },
  });
  if (process.platform === 'darwin') {
    app.dock?.setMenu?.(Menu.buildFromTemplate(template));
  } else if (process.platform === 'win32') {
    // Windows JumpList uses tasks; we emit a Recent category.
    try {
      app.setUserTasks(
        template
          .filter((t) => t.click && typeof t.label === 'string')
          .slice(0, 5)
          .map((t) => ({
            program: process.execPath,
            arguments: '',
            title: t.label,
            description: t.label,
            iconPath: process.execPath,
            iconIndex: 0,
          }))
      );
    } catch (err) {
      console.warn('[jumplist] setUserTasks failed:', err && err.message);
    }
  }
};

const recordRecentNoteOpen = (entry) => {
  const updated = pushRecent(readSettings().recentNotes || [], entry);
  updateSetting('recentNotes', updated);
  refreshRecentNotesMenu();
};

// ---------- application menu ----------
const setupApplicationMenu = () => {
  const template = buildAppMenuTemplate({
    app,
    shell,
    isDev,
    isMac: process.platform === 'darwin',
    on: {
      quit: () => app.quit(),
      checkUpdate: () => {
        const u = getAutoUpdater();
        if (u) {
          u.checkForUpdates().catch((err) => console.warn('[updater] menu check failed:', err && err.message));
        } else {
          dialog.showMessageBox({ type: 'info', message: 'Auto-update not configured for this build.' });
        }
      },
      openAbout: () => {
        try {
          app.setAboutPanelOptions({
            applicationName: 'Noter',
            applicationVersion: app.getVersion(),
            version: app.getVersion(),
            copyright: 'Noter',
          });
          app.showAboutPanel();
        } catch {
          dialog.showMessageBox({ type: 'info', message: `Noter ${app.getVersion()}` });
        }
      },
      toggleDevTools: () => {
        if (!isDev) return;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.toggleDevTools();
        }
      },
    },
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
};

// ---------- app lifecycle ----------
app.whenReady().then(() => {
  setupCrashReporter();
  reconcileLoginItemOnBoot();
  if (process.platform === 'darwin' && readSettings().trayOnly === true) {
    applyTrayOnlyMode(true);
  }
  mainWindow = createWindow();
  createTray();
  setupAutoUpdater();
  setupApplicationMenu();
  setupPowerMonitor();
  refreshRecentNotesMenu();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    } else if (mainWindow) {
      mainWindow.show();
    }
  });
});

app.on('window-all-closed', () => {
  // On macOS we keep the app alive (tray-only mode or standard "background app")
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

const broadcast = (channel, payload) => {
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send(channel, payload);
  });
};

// ---------- IPC handlers ----------
ipcMain.handle('mlc:get-models', async () => {
  const baseDir = app.getPath('userData');
  return getModels(baseDir);
});

ipcMain.handle('mlc:search-models', async (_event, payload) => {
  return searchModels(payload?.query || '');
});

ipcMain.handle('mlc:get-model-files', async (_event, payload) => {
  return getModelFiles(payload?.modelId || '');
});

ipcMain.handle('mlc:download', async (_event, payload) => {
  const baseDir = app.getPath('userData');
  return downloadAndConvert(baseDir, payload, (progress) => {
    broadcast('mlc:download-progress', { id: payload?.id, progress });
  });
});

ipcMain.handle('mlc:delete', async (_event, payload) => {
  const baseDir = app.getPath('userData');
  return deleteModel(baseDir, payload?.id);
});

ipcMain.handle('mlc:chat', async (_event, payload) => {
  const baseDir = app.getPath('userData');
  return runChat(baseDir, payload, (token) => {
    broadcast('mlc:chat-token', { chatId: payload?.chatId, token });
  });
});

ipcMain.handle('mlc:cancel-chat', async (_event, payload) => {
  return cancelChat(payload?.chatId);
});

ipcMain.handle('settings:get', async (_event, key) => {
  const settings = readSettings();
  return settings[key];
});

ipcMain.handle('settings:set', async (_event, payload) => {
  const key = payload?.key;
  if (!key) return false;
  const value = payload?.value;
  updateSetting(key, value);
  // React to known settings changes immediately.
  if (key === 'openAtLogin') applyLoginItemPreference(value === true);
  if (key === 'trayOnly') applyTrayOnlyMode(value === true);
  if (key === 'spellCheckerCdn') {
    BrowserWindow.getAllWindows().forEach((w) => applySpellCheckerCdn(w.webContents.session));
  }
  return true;
});

// ---------- secure store (OS keychain via safeStorage) ----------
// Renderer keeps the auth token + v3 dataKey here, encrypted at rest by the OS,
// instead of plaintext localStorage on disk.
const secureStore = createSecureStore({ app, safeStorage, fs, path });

ipcMain.handle('secure:status', async () => ({ available: secureStore.isAvailable() }));
ipcMain.handle('secure:get', async (_event, key) => secureStore.get(key));
ipcMain.handle('secure:set', async (_event, payload) =>
  secureStore.set(payload?.key, payload?.value),
);
ipcMain.handle('secure:delete', async (_event, key) => secureStore.delete(key));
ipcMain.handle('secure:clear', async () => secureStore.clear());

ipcMain.handle('thumbnails:create', async (_event, payload) => {
  return generateThumbnail(payload?.path, payload?.size);
});

ipcMain.handle('dom:run-isolated', async (event, payload) => {
  if (!event.sender) return null;
  return runIsolatedScript(event.sender, payload?.scriptKey, payload?.arg);
});

ipcMain.handle('updater:check-now', async () => {
  const updater = getAutoUpdater();
  if (!updater) return { ok: false, reason: 'not-installed' };
  try {
    const r = await updater.checkForUpdates();
    return { ok: true, version: r && r.updateInfo && r.updateInfo.version };
  } catch (err) {
    return { ok: false, reason: err && err.message };
  }
});

ipcMain.handle('updater:install-now', async () => {
  const updater = getAutoUpdater();
  if (!updater) return false;
  try { updater.quitAndInstall(false, true); return true; } catch { return false; }
});

// Find-in-page IPC. The renderer's search bar dispatches start/next/prev/stop;
// we forward to webContents.findInPage. `forward` direction is controlled
// per-request.
ipcMain.handle('find:start', async (event, payload) => {
  const text = typeof payload?.text === 'string' ? payload.text : '';
  if (!text) return { ok: false, reason: 'empty' };
  const wc = event.sender;
  if (!wc) return { ok: false };
  try {
    wc.findInPage(text, { findNext: false, matchCase: !!payload?.matchCase });
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err && err.message };
  }
});

ipcMain.handle('find:next', async (event, payload) => {
  const wc = event.sender;
  if (!wc) return { ok: false };
  const text = typeof payload?.text === 'string' ? payload.text : '';
  if (!text) return { ok: false, reason: 'empty' };
  try {
    wc.findInPage(text, { findNext: true, forward: payload?.forward !== false });
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err && err.message };
  }
});

ipcMain.handle('notify:show', async (_event, payload) => {
  return showNativeNotification(payload || {});
});

// Dock badge (macOS). On Windows/Linux the API is a no-op so the renderer
// can dispatch unconditionally without checking platform.
ipcMain.handle('badge:set', async (_event, payload) => {
  const count = Number(payload?.count);
  try {
    if (process.platform === 'darwin') {
      // setBadgeCount with 0 clears; setBadge('') also clears as a string fallback.
      if (typeof app.setBadgeCount === 'function') {
        app.setBadgeCount(Math.max(0, Number.isFinite(count) ? Math.floor(count) : 0));
      } else if (app.dock?.setBadge) {
        app.dock.setBadge(count > 0 ? String(Math.floor(count)) : '');
      }
    } else if (process.platform === 'linux' && typeof app.setBadgeCount === 'function') {
      // Unity launchers support badge counts.
      app.setBadgeCount(Math.max(0, Number.isFinite(count) ? Math.floor(count) : 0));
    }
    return true;
  } catch (err) {
    console.warn('[badge] setBadgeCount failed:', err && err.message);
    return false;
  }
});

ipcMain.handle('recent:record', async (_event, payload) => {
  if (!payload || typeof payload.id !== 'string') return false;
  recordRecentNoteOpen({ id: payload.id, title: payload.title });
  return true;
});

ipcMain.handle('recent:clear', async () => {
  updateSetting('recentNotes', []);
  refreshRecentNotesMenu();
  return true;
});

// Drag-drop file import. The renderer hands us {path,name,type,size}
// for each dropped file; we validate (size/mime/path-traversal) and on OK
// read the contents up to maxBytes. Image binaries return as base64-data-URL
// for direct <img> use; text returns as utf8 strings.
ipcMain.handle('drop:validate', async (_event, files) => {
  if (!Array.isArray(files)) return { results: [] };
  const results = files.slice(0, 32).map((f) => validateDroppedFile(f));
  return { results };
});

ipcMain.handle('drop:read', async (_event, payload) => {
  const validated = validateDroppedFile(payload);
  if (!validated.ok) return validated;
  try {
    const data = fs.readFileSync(validated.resolvedPath);
    const text = (validated.mime || '').startsWith('text/') || validated.ext === '.md' || validated.ext === '.json';
    return {
      ok: true,
      ext: validated.ext,
      mime: validated.mime,
      bytes: validated.bytes,
      ...(text
        ? { kind: 'text', content: data.toString('utf8').slice(0, 200_000) }
        : { kind: 'binary', dataUrl: `data:${validated.mime};base64,${data.toString('base64')}` }
      ),
    };
  } catch (err) {
    return { ok: false, reason: 'read-failed', error: err && err.message };
  }
});

// macOS Sharing menu (uses Electron's ShareMenu). On other platforms we
// no-op so the renderer can dispatch without branching.
ipcMain.handle('share:open', async (event, payload) => {
  if (process.platform !== 'darwin') return { ok: false, reason: 'unsupported-platform' };
  const validated = validateSharePayload(payload || {});
  if (!hasShareablePayload(validated)) return { ok: false, reason: 'empty-payload' };
  try {
    // eslint-disable-next-line global-require
    const { ShareMenu } = require('electron');
    if (!ShareMenu) return { ok: false, reason: 'unavailable' };
    const menu = new ShareMenu(validated);
    const targetWin = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    if (targetWin && !targetWin.isDestroyed()) {
      menu.popup({ window: targetWin });
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err && err.message };
  }
});

// Touch Bar (macOS only). The renderer dispatches `touchbar:set` with one
// of the known context names; we build the template using the host's
// handlers and apply to the focused window.
ipcMain.handle('touchbar:set', async (event, payload) => {
  if (process.platform !== 'darwin') return { ok: false, reason: 'unsupported-platform' };
  const context = typeof payload?.context === 'string' ? payload.context : 'default';
  if (!isValidTouchBarContext(context)) return { ok: false, reason: 'invalid-context' };
  try {
    // eslint-disable-next-line global-require
    const { TouchBar } = require('electron');
    if (!TouchBar) return { ok: false, reason: 'unavailable' };
    const { TouchBarButton, TouchBarSpacer } = TouchBar;
    const template = buildTouchBarTemplate(context, {
      on: {
        newNote: () => mainWindow?.webContents.send('action:newNote'),
        find: () => mainWindow?.webContents.send('action:find'),
        save: () => mainWindow?.webContents.send('action:save'),
        findPrev: () => mainWindow?.webContents.send('action:findPrev'),
        findNext: () => mainWindow?.webContents.send('action:findNext'),
        findStop: () => mainWindow?.webContents.send('action:findStop'),
        openSettings: () => mainWindow?.webContents.send('action:openSettings'),
      },
    });
    const items = template.map((it) => {
      if (it.type === 'spacer') return new TouchBarSpacer({ size: it.size });
      return new TouchBarButton({ label: it.label, click: it.click });
    });
    const targetWin = BrowserWindow.fromWebContents(event.sender) || mainWindow;
    if (targetWin && !targetWin.isDestroyed()) {
      targetWin.setTouchBar(new TouchBar({ items }));
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err && err.message };
  }
});

// Native print + printToPDF. Note-locked content (locked: true in settings)
// is opt-out — we refuse to print a locked note from the IPC path so users
// don't accidentally generate a paper copy of something they meant to keep
// encrypted-at-rest.
ipcMain.handle('print:show', async (event, payload) => {
  const wc = event.sender;
  if (!wc) return { ok: false, reason: 'no-sender' };
  if (payload?.lockedNote === true) {
    return { ok: false, reason: 'note-is-locked' };
  }
  const opts = validatePrintOptions(payload?.options || {}, { kind: 'print' });
  return new Promise((resolve) => {
    try {
      wc.print(opts, (success, failureReason) => {
        resolve({ ok: success, reason: failureReason });
      });
    } catch (err) {
      resolve({ ok: false, reason: err && err.message });
    }
  });
});

ipcMain.handle('print:to-pdf', async (event, payload) => {
  const wc = event.sender;
  if (!wc) return { ok: false, reason: 'no-sender' };
  if (payload?.lockedNote === true) {
    return { ok: false, reason: 'note-is-locked' };
  }
  const opts = validatePrintOptions(payload?.options || {}, { kind: 'pdf' });
  try {
    const buf = await wc.printToPDF(opts);
    return {
      ok: true,
      dataUrl: `data:application/pdf;base64,${buf.toString('base64')}`,
      bytes: buf.length,
    };
  } catch (err) {
    return { ok: false, reason: err && err.message };
  }
});

// Multi-window: open the given note in its own BrowserWindow. Re-uses the
// session/preload/devTools-gating from the main window. Closing the note
// window only closes itself — the main window keeps running.
ipcMain.handle('note:open-window', async (_event, payload) => {
  const noteId = typeof payload?.id === 'string' ? payload.id : '';
  const built = buildNoteWindowOptions(noteId, { isDev });
  if (!built.ok) return { ok: false, reason: built.reason };
  try {
    const win = new BrowserWindow(built.options);
    win.once('ready-to-show', () => win.show());
    // For now we point each note window at the same renderer root + ship
    // the deeplink via IPC after did-finish-load.
    const rendererIndex = path.join(__dirname, 'renderer', 'app', 'index.html');
    if (fs.existsSync(rendererIndex)) {
      win.loadFile(rendererIndex);
    } else if (process.env.ELECTRON_RENDERER_URL) {
      win.loadURL(process.env.ELECTRON_RENDERER_URL);
    }
    win.webContents.once('did-finish-load', () => {
      win.webContents.send('note:open', { deeplink: built.deeplink });
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err && err.message };
  }
});

// Spell-check user dictionary. Stored in settings.json so additions
// survive reinstalls; re-applied to the session on every new window via
// reconcileSpellCheckerDictionary() (called from createWindow).
const reconcileSpellCheckerDictionary = (session) => {
  const stored = reconcileUserDictWords(readSettings().userDictionary || []);
  for (const word of stored) {
    try { session.addWordToSpellCheckerDictionary(word); } catch { /* noop */ }
  }
};

ipcMain.handle('dictionary:add', async (event, payload) => {
  const result = addUserDictWord(readSettings().userDictionary || [], payload?.word);
  if (!result.ok) return result;
  updateSetting('userDictionary', result.list);
  try {
    const session = event.sender?.session;
    if (session && typeof session.addWordToSpellCheckerDictionary === 'function') {
      session.addWordToSpellCheckerDictionary(payload.word);
    }
  } catch { /* noop */ }
  return result;
});

ipcMain.handle('dictionary:remove', async (event, payload) => {
  const result = removeUserDictWord(readSettings().userDictionary || [], payload?.word);
  if (!result.ok) return result;
  updateSetting('userDictionary', result.list);
  try {
    const session = event.sender?.session;
    if (session && typeof session.removeWordFromSpellCheckerDictionary === 'function') {
      session.removeWordFromSpellCheckerDictionary(payload.word);
    }
  } catch { /* noop */ }
  return result;
});

ipcMain.handle('dictionary:list', async () => {
  return { ok: true, words: reconcileUserDictWords(readSettings().userDictionary || []) };
});

// Native file dialogs with validation. Each call returns the cancelled
// state explicitly so the renderer can distinguish "user backed out" from
// "dialog failed".
ipcMain.handle('dialog:open', async (event, payload) => {
  const opts = validateOpenDialogOptions(payload || {});
  const targetWin = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  try {
    const result = targetWin
      ? await dialog.showOpenDialog(targetWin, opts)
      : await dialog.showOpenDialog(opts);
    return { ok: true, canceled: result.canceled, paths: result.filePaths };
  } catch (err) {
    return { ok: false, reason: err && err.message };
  }
});

ipcMain.handle('dialog:save', async (event, payload) => {
  const opts = validateSaveDialogOptions(payload || {});
  const targetWin = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  try {
    const result = targetWin
      ? await dialog.showSaveDialog(targetWin, opts)
      : await dialog.showSaveDialog(opts);
    return { ok: true, canceled: result.canceled, path: result.filePath };
  } catch (err) {
    return { ok: false, reason: err && err.message };
  }
});

// Print preview: render the source window to PDF, then open a transient
// window showing that PDF inline with Print/Close buttons.
ipcMain.handle('print:preview', async (event, payload) => {
  const wc = event.sender;
  if (!wc) return { ok: false, reason: 'no-sender' };
  if (payload?.lockedNote === true) return { ok: false, reason: 'note-is-locked' };
  try {
    const pdfOpts = require('./src/printOptions').validatePrintOptions(payload?.options || {}, { kind: 'pdf' });
    const buf = await wc.printToPDF(pdfOpts);
    const dataUrl = `data:application/pdf;base64,${buf.toString('base64')}`;
    const html = buildPreviewHtml({ dataUrl, title: payload?.title || 'Print preview', bytes: buf.length });
    const sourceWin = BrowserWindow.fromWebContents(wc) || mainWindow;
    const parentBounds = sourceWin && !sourceWin.isDestroyed() ? sourceWin.getBounds() : undefined;
    const preview = new BrowserWindow(previewWindowOptions({ parentBounds }));
    preview.once('ready-to-show', () => preview.show());
    preview.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

    // Listen for messages from the preview HTML's buttons. Because the
    // preview has no preload, we can't use IPC — we use window-postMessage
    // bridging via webContents.executeJavaScript.
    preview.webContents.on('did-finish-load', () => {
      preview.webContents.executeJavaScript(`
        window.addEventListener('message', (e) => {
          if (e.data && e.data.kind === 'print') {
            window.__noter_action = 'print';
          } else if (e.data && e.data.kind === 'cancel') {
            window.__noter_action = 'cancel';
          }
        }, false);
      `, true).catch(() => undefined);
    });

    // Poll for the action — lightweight and safe inside a transient
    // window that we control.
    const poll = setInterval(async () => {
      if (preview.isDestroyed()) { clearInterval(poll); return; }
      try {
        const action = await preview.webContents.executeJavaScript('window.__noter_action', true);
        if (action === 'print') {
          clearInterval(poll);
          preview.close();
          wc.print(require('./src/printOptions').validatePrintOptions(payload?.options || {}, { kind: 'print' }));
        } else if (action === 'cancel') {
          clearInterval(poll);
          preview.close();
        }
      } catch { /* noop */ }
    }, 300);
    preview.on('closed', () => clearInterval(poll));
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err && err.message };
  }
});

// Resource monitor — exposes app.getAppMetrics() to the renderer for the
// debug overlay. Sensitive enough to gate behind a settings flag.
ipcMain.handle('metrics:app', async () => {
  if (readSettings().debugOverlayEnabled !== true) {
    return { ok: false, reason: 'disabled' };
  }
  try {
    const metrics = (typeof app.getAppMetrics === 'function' ? app.getAppMetrics() : []).map((m) => ({
      pid: m.pid,
      type: m.type,
      cpu: m.cpu ? { percentCPUUsage: m.cpu.percentCPUUsage, idleWakeupsPerSecond: m.cpu.idleWakeupsPerSecond } : undefined,
      memory: m.memory,
      name: m.name,
    }));
    const sys = typeof app.getSystemVersion === 'function' ? app.getSystemVersion() : undefined;
    return { ok: true, processes: metrics, system: { version: sys, platform: process.platform } };
  } catch (err) {
    return { ok: false, reason: err && err.message };
  }
});

ipcMain.handle('find:stop', async (event, payload) => {
  const wc = event.sender;
  if (!wc) return false;
  try {
    // 'clearSelection' is the kindest action — 'activateSelection' would
    // navigate to the link if the highlighted text was inside an anchor.
    wc.stopFindInPage(payload?.action === 'keep' ? 'keepSelection' : 'clearSelection');
    return true;
  } catch {
    return false;
  }
});

// Expose nativeTheme dark-mode signal so renderer can listen for system theme
nativeTheme.on('updated', () => {
  broadcast('theme:updated', { shouldUseDarkColors: nativeTheme.shouldUseDarkColors });
  // Re-apply vibrancy with the new theme so the window blends correctly.
  if (process.platform === 'darwin' && mainWindow && !mainWindow.isDestroyed() && typeof mainWindow.setVibrancy === 'function') {
    const theme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
    const material = resolveVibrancyForTheme(theme);
    if (material && isValidVibrancyMaterial(material)) {
      try { mainWindow.setVibrancy(material); } catch { /* noop */ }
    }
  }
});

// Battery-aware auto-update: when on battery + warm, defer checks. We
// re-evaluate every 5 minutes so the window opens as soon as the user
// plugs in or the system cools off.
const evaluatePowerPolicy = () => {
  let onBattery = false;
  let thermalState = 'unknown';
  try { onBattery = !!(powerMonitor && powerMonitor.isOnBatteryPower && powerMonitor.isOnBatteryPower()); } catch { /* noop */ }
  try { thermalState = (powerMonitor && powerMonitor.getCurrentThermalState && powerMonitor.getCurrentThermalState()) || 'unknown'; } catch { /* noop */ }
  return resolveBackgroundPolicy({ onBattery, thermalState });
};

// Renderer-facing event stream for the updater UI — one normalised
// state-machine view of the underlying electron-updater events.
const updaterMachine = createUpdaterStateMachine();
const dispatchUpdaterEvent = (event) => {
  const next = updaterMachine.dispatch(event);
  broadcast('updater:state', next);
};
ipcMain.handle('updater:get-state', async () => updaterMachine.get());
