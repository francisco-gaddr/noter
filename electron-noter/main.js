const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { getModels, downloadAndConvert, deleteModel, runChat, cancelChat, searchModels, getModelFiles } = require('./src/mlc');

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
    }
  }
  return false;
};

const createWindow = () => {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
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

  return win;
};

app.whenReady().then(() => {
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
  const settings = readSettings();
  return settings[key];
});

ipcMain.handle('settings:set', async (_event, payload) => {
  const key = payload?.key;
  if (!key) return false;
  const value = payload?.value;
  const settings = readSettings();
  if (value === null || value === undefined) {
    delete settings[key];
  } else {
    settings[key] = value;
  }
  writeSettings(settings);
  return true;
});
