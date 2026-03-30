const { app, BrowserWindow, ipcMain, safeStorage, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { getModels, downloadAndConvert, deleteModel, runChat, cancelChat, searchModels, getModelFiles } = require('./src/mlc');

const isDev = process.env.NODE_ENV === 'development';
const isTest = process.env.ELECTRON_TEST === '1';
const devUrl = 'http://localhost:3001/';
const remoteUrl = 'https://daylited.com/';
const userDataDir = process.env.ELECTRON_USER_DATA_DIR;
const settingsFileName = 'settings.json';
const encryptedSettingsVersion = 1;
const rendererRecoveryDelayMs = 2500;
const allowedExternalProtocols = new Set(['https:', 'http:']);
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

const readSettings = () => {
  try {
    const filePath = path.join(app.getPath('userData'), settingsFileName);
    if (!fs.existsSync(filePath)) return {};
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed?.__encrypted === true && typeof parsed.payload === 'string') {
      if (!safeStorage?.isEncryptionAvailable?.()) return {};
      const decrypted = safeStorage.decryptString(Buffer.from(parsed.payload, 'base64'));
      const data = JSON.parse(decrypted);
      return data && typeof data === 'object' ? data : {};
    }
    if (safeStorage?.isEncryptionAvailable?.()) {
      return parsed && typeof parsed === 'object' ? parsed : {};
    }
    return {};
  } catch {
    return {};
  }
};

const writeSettings = (next) => {
  if (!safeStorage?.isEncryptionAvailable?.()) {
    return false;
  }
  const filePath = path.join(app.getPath('userData'), settingsFileName);
  const encrypted = safeStorage.encryptString(JSON.stringify(next));
  fs.writeFileSync(filePath, JSON.stringify({
    __encrypted: true,
    version: encryptedSettingsVersion,
    payload: encrypted.toString('base64'),
  }));
  return true;
};

let settingsCache = {};
let settingsWriteQueue = Promise.resolve();
let pendingSettingsSnapshot = null;
let pendingSettingsResolvers = [];
let settingsFlushTimer = null;

const flushPendingSettingsWrite = () => {
  if (!pendingSettingsSnapshot) return;
  const snapshot = pendingSettingsSnapshot;
  const resolvers = pendingSettingsResolvers.splice(0);
  pendingSettingsSnapshot = null;
  writeSettings(snapshot);
  settingsCache = snapshot;
  resolvers.forEach((resolve) => resolve());
};

const enqueueSettingsWrite = (mutate) => {
  settingsWriteQueue = settingsWriteQueue.then(() => new Promise((resolve) => {
    const next = { ...((pendingSettingsSnapshot || settingsCache) || {}) };
    mutate(next);
    pendingSettingsSnapshot = next;
    pendingSettingsResolvers.push(resolve);
    if (settingsFlushTimer) {
      clearTimeout(settingsFlushTimer);
    }
    settingsFlushTimer = setTimeout(() => {
      settingsFlushTimer = null;
      flushPendingSettingsWrite();
    }, 120);
  })).catch(() => {});
  return settingsWriteQueue;
};

app.on('before-quit', () => {
  if (settingsFlushTimer) {
    clearTimeout(settingsFlushTimer);
    settingsFlushTimer = null;
  }
  flushPendingSettingsWrite();
});

const loadErrorFallback = async (win) => {
  const html = `
  <!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Noter</title>
      <style>
        body { margin: 0; background: #0f172a; color: #e2e8f0; font-family: Arial, sans-serif; }
        .wrap { max-width: 620px; margin: 72px auto; padding: 24px; background: #111827; border: 1px solid #334155; border-radius: 12px; }
        h1 { margin: 0 0 10px 0; font-size: 22px; }
        p { margin: 0 0 14px 0; line-height: 1.5; }
      </style>
    </head>
    <body>
      <div class="wrap">
        <h1>Noter kunde inte laddas</h1>
        <p>Renderern är tillfälligt otillgänglig.</p>
        <p>Försöker återansluta automatiskt…</p>
      </div>
    </body>
  </html>
  `;
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
};

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
    }
  }
  return false;
};

const isSafeExternalUrl = (url) => {
  try {
    const parsed = new URL(url);
    return allowedExternalProtocols.has(parsed.protocol);
  } catch {
    return false;
  }
};

const openExternalSafely = (url) => {
  if (!url || !isSafeExternalUrl(url)) {
    return false;
  }
  shell.openExternal(url).catch(() => {});
  return true;
};

const createWindow = () => {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafely(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    const currentUrl = win.webContents.getURL();
    if (url && currentUrl && url !== currentUrl) {
      event.preventDefault();
      openExternalSafely(url);
    }
  });

  if (isTest) {
    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent('<!doctype html><html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Electron Noter Test</title></head><body data-mlc="ready"><main id="app">Electron Noter Test</main></body></html>')}`);
    return win;
  }

  const rendererIndex = path.join(__dirname, 'renderer', 'index.html');
  const legacyRendererIndex = path.join(__dirname, 'renderer', 'app', 'index.html');
  let recovering = false;
  let recoveryTimer = null;
  const scheduleRendererRecovery = () => {
    if (recoveryTimer || win.isDestroyed()) return;
    recoveryTimer = setTimeout(() => {
      recoveryTimer = null;
      recoverRenderer().catch(() => {});
    }, rendererRecoveryDelayMs);
  };
  const recoverRenderer = async () => {
    if (recovering || win.isDestroyed()) return;
    recovering = true;
    try {
      await loadErrorFallback(win);
      const loaded = await loadFirstReachableUrl(win);
      if (!loaded && !win.isDestroyed()) {
        await loadErrorFallback(win);
        scheduleRendererRecovery();
      }
    } finally {
      recovering = false;
    }
  };

  if (isDev) {
    win.loadURL(devUrl);
  } else if (fs.existsSync(rendererIndex)) {
    win.loadFile(rendererIndex);
  } else if (fs.existsSync(legacyRendererIndex)) {
    win.loadFile(legacyRendererIndex);
  } else {
    recoverRenderer();
  }

  win.webContents.on('did-fail-load', () => {
    recoverRenderer().catch(() => {});
  });

  win.webContents.on('did-finish-load', () => {
    if (recoveryTimer) {
      clearTimeout(recoveryTimer);
      recoveryTimer = null;
    }
  });

  win.on('closed', () => {
    if (recoveryTimer) {
      clearTimeout(recoveryTimer);
      recoveryTimer = null;
    }
  });

  return win;
};

app.whenReady().then(() => {
  settingsCache = readSettings();
  writeSettings(settingsCache);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

const broadcast = (channel, payload) => {
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send(channel, payload);
  });
};

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
  const settings = settingsCache || readSettings();
  return settings[key];
});

ipcMain.handle('settings:set', async (_event, payload) => {
  const key = payload?.key;
  if (!key) return false;
  const value = payload?.value;
  await enqueueSettingsWrite((settings) => {
    if (value === null || value === undefined) {
      delete settings[key];
    } else {
      settings[key] = value;
    }
  });
  return true;
});
