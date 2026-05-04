const { app, BrowserWindow, ipcMain, safeStorage, shell, session } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');
const { spawn } = require('child_process');
const { createCipheriv, createDecipheriv, randomBytes } = require('crypto');
const {
  getElectronPerformanceSnapshot,
  recordAiChatSample,
  recordAiDownloadSample,
  recordSettingsQueueEnqueue,
  recordSettingsQueueFlush,
  recordStartupEvent,
  resetElectronPerformanceSnapshot,
} = require('./src/perfMetrics');

const isDev = process.env.NODE_ENV === 'development';
const isTest = process.env.ELECTRON_TEST === '1';
const devUrl = process.env.ELECTRON_RENDERER_URL || 'http://localhost:3001/';
const userDataDir = process.env.ELECTRON_USER_DATA_DIR;
const settingsFileName = 'settings.json';
const settingsKeyFileName = 'settings.key';
const encryptedSettingsVersion = 1;
const rendererRecoveryDelayMs = 2500;
const allowedExternalProtocols = new Set(['https:', 'http:']);
const allowedHttpBridgeMethods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']);
const allowedHttpBridgeHosts = new Set([
  'huggingface.co',
  'api.openrouter.ai',
  'generativelanguage.googleapis.com',
]);
const rendererCsp = [
  "default-src 'self'",
  "connect-src 'self' http://127.0.0.1:* http://localhost:* https://api.openrouter.ai https://huggingface.co https://generativelanguage.googleapis.com",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "frame-ancestors 'none'",
].join('; ');
const rendererCspDev = [
  "default-src 'self'",
  "connect-src 'self' http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:* https://api.openrouter.ai https://huggingface.co https://generativelanguage.googleapis.com",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "frame-ancestors 'none'",
].join('; ');
let mlcModule = null;
let rendererServer = null;
let rendererServerPort = 0;
let isShowingRendererFallback = false;
let mainLogStream = null;
let mainLogBytesSinceCheck = 0;

const getMainLogDir = () => path.join(app.getPath('userData'), 'logs');
const getMainLogPath = () => path.join(getMainLogDir(), 'main.log');
const rotateMainLogIfNeeded = () => {
  const filePath = getMainLogPath();
  const maxBytes = 1024 * 1024;
  const maxFiles = 3;
  try {
    if (!fs.existsSync(filePath)) return;
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size < maxBytes) return;
    if (mainLogStream) {
      try {
        mainLogStream.end();
      } catch {}
      mainLogStream = null;
    }
    for (let i = maxFiles; i >= 1; i -= 1) {
      const src = i === 1 ? filePath : `${filePath}.${i - 1}`;
      const dst = `${filePath}.${i}`;
      if (fs.existsSync(dst)) {
        try {
          fs.unlinkSync(dst);
        } catch {}
      }
      if (fs.existsSync(src)) {
        try {
          fs.renameSync(src, dst);
        } catch {}
      }
    }
  } catch {}
};
const ensureMainLogStream = () => {
  if (mainLogStream) return;
  try {
    fs.mkdirSync(getMainLogDir(), { recursive: true });
    rotateMainLogIfNeeded();
    mainLogStream = fs.createWriteStream(getMainLogPath(), { flags: 'a' });
    mainLogBytesSinceCheck = 0;
  } catch {
    mainLogStream = null;
  }
};
const writeMainLog = (event, payload) => {
  try {
    ensureMainLogStream();
    const line = JSON.stringify({ ts: new Date().toISOString(), event, ...payload });
    if (mainLogStream) {
      mainLogStream.write(line + '\n');
      mainLogBytesSinceCheck += line.length + 1;
      if (mainLogBytesSinceCheck > 64 * 1024) {
        mainLogBytesSinceCheck = 0;
        rotateMainLogIfNeeded();
      }
    }
  } catch {}
};
const installMainProcessErrorHandlers = () => {
  process.on('uncaughtException', (err) => {
    writeMainLog('uncaughtException', { error: String(err?.stack || err?.message || err) });
  });
  process.on('unhandledRejection', (reason) => {
    writeMainLog('unhandledRejection', { error: String(reason?.stack || reason?.message || reason) });
  });
};

const getStandaloneRendererServerPath = () => {
  const relativePath = path.join('renderer-standalone', 'apps', 'web', 'server.js');
  const candidates = [
    path.join(process.resourcesPath || '', 'app.asar.unpacked', relativePath),
    path.join(process.resourcesPath || '', relativePath),
    path.join(__dirname, relativePath),
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
};

const getRendererFallbackUrls = () => {
  if (isDev) {
    return Array.from(new Set([
      process.env.ELECTRON_RENDERER_URL,
      process.env.ELECTRON_RENDERER_FALLBACK_URL,
      devUrl,
      'http://127.0.0.1:3001/',
    ].filter(Boolean)));
  }
  return Array.from(new Set([
    process.env.ELECTRON_RENDERER_URL,
    process.env.ELECTRON_RENDERER_FALLBACK_URL,
  ].filter(Boolean)));
};

const findFreePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    server.close(() => resolve(port));
  });
  server.on('error', reject);
});

const startStandaloneRenderer = async () => {
  if (rendererServer) return { port: rendererServerPort };
  const serverJs = getStandaloneRendererServerPath();
  if (!fs.existsSync(serverJs)) return null;
  const port = await findFreePort();
  const childEnv = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    PORT: String(port),
    HOSTNAME: '127.0.0.1',
    NODE_ENV: 'production',
  };
  const child = spawn(process.execPath, [serverJs], {
    cwd: path.dirname(serverJs),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: childEnv,
  });
  recordStartupEvent('renderer-server-started', { source: 'spawn', url: serverJs });
  writeMainLog('renderer-server-started', { url: serverJs, port });
  rendererServer = child;
  rendererServerPort = port;
  child.stdout?.on('data', (chunk) => {
    const text = String(chunk || '').slice(0, 4000);
    if (text) writeMainLog('renderer-stdout', { text });
  });
  child.stderr?.on('data', (chunk) => {
    const text = String(chunk || '').slice(0, 4000);
    if (text) writeMainLog('renderer-stderr', { text });
  });
  child.on('spawn', () => {
    recordStartupEvent('renderer-server-spawned', { url: `http://127.0.0.1:${port}/` });
    writeMainLog('renderer-server-spawned', { url: `http://127.0.0.1:${port}/` });
  });
  child.on('exit', (code) => {
    recordStartupEvent('renderer-server-exit', { error: String(code ?? 'unknown') });
    writeMainLog('renderer-server-exit', { code: code ?? null });
    rendererServer = null;
    rendererServerPort = 0;
  });
  return { port };
};

const getMlcModule = () => {
  if (!mlcModule) {
    mlcModule = require('./src/mlc');
  }
  return mlcModule;
};

const isSafeStorageAvailable = () => {
  if (process.env.ELECTRON_DISABLE_SAFESTORAGE === '1') return false;
  return Boolean(safeStorage?.isEncryptionAvailable?.());
};

const getSettingsFilePath = () => path.join(app.getPath('userData'), settingsFileName);
const getSettingsKeyPath = () => path.join(app.getPath('userData'), settingsKeyFileName);

const getLocalSettingsKey = () => {
  const keyPath = getSettingsKeyPath();
  fs.mkdirSync(path.dirname(keyPath), { recursive: true });
  if (fs.existsSync(keyPath)) {
    return fs.readFileSync(keyPath);
  }
  const key = randomBytes(32);
  fs.writeFileSync(keyPath, key, { mode: 0o600 });
  return key;
};

const encryptSettingsPayload = (value) => {
  const json = JSON.stringify(value);
  if (isSafeStorageAvailable()) {
    const encrypted = safeStorage.encryptString(json);
    return {
      __encrypted: true,
      mode: 'safeStorage',
      version: encryptedSettingsVersion,
      payload: encrypted.toString('base64'),
    };
  }
  const iv = randomBytes(12);
  const key = getLocalSettingsKey();
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    __encrypted: true,
    mode: 'localKey',
    version: encryptedSettingsVersion,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    payload: encrypted.toString('base64'),
  };
};

const decryptSettingsPayload = (parsed) => {
  if (!parsed?.__encrypted || typeof parsed.payload !== 'string') return {};
  if ((parsed.mode === 'localKey' || (!isSafeStorageAvailable() && parsed.iv && parsed.tag))) {
    const key = getLocalSettingsKey();
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(String(parsed.iv || ''), 'base64'),
    );
    decipher.setAuthTag(Buffer.from(String(parsed.tag || ''), 'base64'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(parsed.payload, 'base64')),
      decipher.final(),
    ]).toString('utf8');
    const data = JSON.parse(decrypted);
    return data && typeof data === 'object' ? data : {};
  }
  if (!isSafeStorageAvailable()) return {};
  const decrypted = safeStorage.decryptString(Buffer.from(parsed.payload, 'base64'));
  const data = JSON.parse(decrypted);
  return data && typeof data === 'object' ? data : {};
};

if (userDataDir) {
  app.setPath('userData', userDataDir);
}

const readSettings = () => {
  try {
    const filePath = getSettingsFilePath();
    if (!fs.existsSync(filePath)) return {};
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed?.__encrypted === true && typeof parsed.payload === 'string') {
      return decryptSettingsPayload(parsed);
    }
    if (isSafeStorageAvailable()) {
      return parsed && typeof parsed === 'object' ? parsed : {};
    }
    return {};
  } catch {
    return {};
  }
};

const writeSettings = (next) => {
  const filePath = getSettingsFilePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(encryptSettingsPayload(next)));
  return true;
};

const shouldRewriteSettingsOnStartup = () => {
  try {
    const filePath = getSettingsFilePath();
    if (!fs.existsSync(filePath)) {
      return true;
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (isSafeStorageAvailable()) {
      return !(parsed?.__encrypted === true && typeof parsed.payload === 'string');
    }
    return !(parsed?.__encrypted === true && typeof parsed.payload === 'string' && (parsed.mode === 'localKey' || (parsed.iv && parsed.tag)));
  } catch {
    return true;
  }
};

let settingsCache = {};
let settingsWriteQueue = Promise.resolve();
let pendingSettingsSnapshot = null;
let pendingSettingsResolvers = [];
let settingsFlushTimer = null;
const getEffectiveSettingsSnapshot = () => pendingSettingsSnapshot || settingsCache || readSettings();
const isSafeSettingKey = (key) => (
  typeof key === 'string'
  && key.length > 0
  && key.length <= 128
  && /^[a-zA-Z0-9._:-]+$/.test(key)
  && key !== '__proto__'
  && key !== 'prototype'
  && key !== 'constructor'
);
const sanitizeSettingKeys = (keys) => Array.isArray(keys) ? keys.filter(isSafeSettingKey).slice(0, 32) : [];
const sanitizeSettingEntries = (entries) => Object.entries(entries || {}).filter(([key]) => isSafeSettingKey(key)).slice(0, 32);
const sensitiveSessionKeys = new Set(['token', 'user']);
const isSensitiveSessionKey = (key) => sensitiveSessionKeys.has(String(key || ''));
const filterSafeSettingKeys = (keys) => sanitizeSettingKeys(keys).filter((key) => !isSensitiveSessionKey(key));
const filterSafeSettingEntries = (entries) => sanitizeSettingEntries(entries).filter(([key]) => !isSensitiveSessionKey(key));

const flushPendingSettingsWrite = () => {
  if (!pendingSettingsSnapshot) return;
  const flushStartedAt = Date.now();
  const snapshot = pendingSettingsSnapshot;
  const resolvers = pendingSettingsResolvers.splice(0);
  pendingSettingsSnapshot = null;
  writeSettings(snapshot);
  settingsCache = snapshot;
  recordSettingsQueueFlush({
    durationMs: Date.now() - flushStartedAt,
    snapshotKeys: Object.keys(snapshot || {}).length,
  });
  resolvers.forEach((resolve) => resolve());
};

const enqueueSettingsWrite = (mutate) => {
  settingsWriteQueue = settingsWriteQueue.then(() => new Promise((resolve) => {
    const next = { ...((pendingSettingsSnapshot || settingsCache) || {}) };
    mutate(next);
    pendingSettingsSnapshot = next;
    pendingSettingsResolvers.push(resolve);
    recordSettingsQueueEnqueue({
      pendingResolvers: pendingSettingsResolvers.length,
      coalesced: Boolean(settingsFlushTimer),
    });
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
  if (rendererServer?.kill) {
    try {
      rendererServer.kill();
    } catch {}
  }
  if (settingsFlushTimer) {
    clearTimeout(settingsFlushTimer);
    settingsFlushTimer = null;
  }
  flushPendingSettingsWrite();
});

const loadErrorFallback = async (win) => {
  if (win.isDestroyed()) return;
  if (isShowingRendererFallback) return;
  isShowingRendererFallback = true;
  recordStartupEvent('renderer-fallback-shown');
  const html = `
  <!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; connect-src 'none'; script-src 'none'" />
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
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  } catch {}
};

const isUrlReachable = async (url) => {
  try {
    const res = await fetch(url, { method: 'GET', redirect: 'manual' });
    return res.ok || (res.status >= 300 && res.status < 400);
  } catch {
    return false;
  }
};

const loadUrlWithRetries = async (win, url, attempts = 20, delayMs = 250) => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (win.isDestroyed()) return false;
    recordStartupEvent('renderer-load-attempt', { url });
    try {
      await win.loadURL(url);
      recordStartupEvent('renderer-load-success', { url });
      return true;
    } catch (error) {
      recordStartupEvent('renderer-load-error', { url, error: String(error?.message || error) });
      if (attempt < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  return false;
};

const loadFirstReachableUrl = async (win) => {
  const rendererFallbackUrls = getRendererFallbackUrls();
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

const sanitizeHttpBridgeHeaders = (headers) => (
  Object.entries(headers || {})
    .filter(([key, value]) => (
      typeof key === 'string'
      && key.length > 0
      && key.length <= 128
      && /^[a-zA-Z0-9-]+$/.test(key)
      && typeof value === 'string'
      && value.length <= 4096
    ))
    .slice(0, 50)
    .reduce((acc, [key, value]) => {
      acc[key] = value;
      return acc;
    }, {})
);

const getConfiguredBackendOrigins = () => {
  const candidates = [
    settingsCache?.apiBaseUrl,
    settingsCache?.apiUrl,
    settingsCache?.backendUrl,
    process.env.API_URL,
    process.env.NEXT_PUBLIC_API_URL,
  ].filter(Boolean);
  const origins = new Set(['http://127.0.0.1:3001', 'http://localhost:3001']);
  candidates.forEach((candidate) => {
    try {
      const parsed = new URL(String(candidate));
      origins.add(parsed.origin);
    } catch {}
  });
  return origins;
};

const isAllowedHttpBridgeUrl = (url) => {
  if (!isSafeExternalUrl(url)) return false;
  try {
    const parsed = new URL(url);
    if (allowedHttpBridgeHosts.has(parsed.hostname.toLowerCase())) return true;
    return getConfiguredBackendOrigins().has(parsed.origin);
  } catch {
    return false;
  }
};

const canSendSensitiveBridgeHeaders = (url) => {
  try {
    const parsed = new URL(url);
    return getConfiguredBackendOrigins().has(parsed.origin);
  } catch {
    return false;
  }
};

const sanitizeBridgeRequestHeaders = (url, headers) => {
  const allowSensitiveHeaders = canSendSensitiveBridgeHeaders(url);
  const blocked = new Set(['cookie', 'host', 'connection', 'content-length', 'transfer-encoding']);
  return Object.entries(sanitizeHttpBridgeHeaders(headers)).reduce((acc, [key, value]) => {
    const normalizedKey = String(key).toLowerCase();
    if (blocked.has(normalizedKey)) return acc;
    if (!allowSensitiveHeaders && normalizedKey === 'authorization') return acc;
    acc[key] = value;
    return acc;
  }, {});
};

const isInternalAppUrl = (url) => {
  if (!url) return false;
  if (url.startsWith('data:text/html')) return true;
  if (url.startsWith('file://')) return true;
  try {
    const parsed = new URL(url);
    const isLocalHttp = (parsed.protocol === 'http:' || parsed.protocol === 'https:')
      && (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost');
    return isLocalHttp;
  } catch {
    return false;
  }
};

const getTrustedRendererOrigins = () => {
  const origins = new Set();
  if (isDev) {
    getRendererFallbackUrls().forEach((candidate) => {
      try {
        origins.add(new URL(String(candidate)).origin);
      } catch {}
    });
    try {
      origins.add(new URL(String(devUrl)).origin);
    } catch {}
  }
  if (!isDev) {
    if (rendererServerPort) {
      origins.add(`http://127.0.0.1:${rendererServerPort}`);
    }
  }
  return origins;
};

const isTrustedRendererUrl = (url) => {
  if (!url) return false;
  if (url.startsWith('data:text/html')) {
    return isTest || isShowingRendererFallback;
  }
  if (url.startsWith('file://')) {
    try {
      const parsed = new URL(url);
      const filePath = decodeURIComponent(parsed.pathname || '');
      const rendererDir = path.join(__dirname, 'renderer') + path.sep;
      return filePath.startsWith(rendererDir);
    } catch {
      return false;
    }
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const origin = parsed.origin;
    const trustedOrigins = getTrustedRendererOrigins();
    if (trustedOrigins.has(origin)) return true;
    return false;
  } catch {
    return false;
  }
};

const assertTrustedIpcSender = (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) throw new Error('Untrusted IPC sender');
  const url = event.senderFrame?.url || event.sender.getURL();
  if (!isTrustedRendererUrl(url)) throw new Error('Untrusted IPC sender');
};

const createWindow = () => {
  recordStartupEvent('window-created');
  const isMac = process.platform === 'darwin';
  const win = new BrowserWindow({
    show: isTest,
    width: 1280,
    height: 800,
    backgroundColor: isMac ? '#00000000' : '#0f172a',
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    vibrancy: isMac ? 'sidebar' : undefined,
    visualEffectState: isMac ? 'active' : undefined,
    trafficLightPosition: isMac ? { x: 16, y: 14 } : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  win.webContents.on('render-process-gone', (_event, details) => {
    writeMainLog('render-process-gone', { reason: details?.reason, exitCode: details?.exitCode });
  });
  win.on('unresponsive', () => {
    writeMainLog('window-unresponsive', {});
  });
  win.on('responsive', () => {
    writeMainLog('window-responsive', {});
  });

  if (isMac) {
    try {
      win.setWindowButtonVisibility(true);
    } catch {}
    try {
      if (typeof win.setBackgroundMaterial === 'function') {
        win.setBackgroundMaterial('sidebar');
      }
    } catch {}
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isInternalAppUrl(url)) {
      return { action: 'allow' };
    }
    openExternalSafely(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    const currentUrl = win.webContents.getURL();
    if (isInternalAppUrl(url)) {
      return;
    }
    if (url && currentUrl && url !== currentUrl) {
      event.preventDefault();
      openExternalSafely(url);
    }
  });

  if (isTest) {
    recordStartupEvent('load-started', { source: 'test' });
    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent('<!doctype html><html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Electron Noter Test</title></head><body data-mlc="ready"><main id="app">Electron Noter Test</main></body></html>')}`);
    return win;
  }

  const rendererIndex = path.join(__dirname, 'renderer', 'index.html');
  const legacyRendererIndex = path.join(__dirname, 'renderer', 'app', 'index.html');
  const standaloneRendererServer = getStandaloneRendererServerPath();
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
    recordStartupEvent('renderer-recovery');
    try {
      await loadErrorFallback(win);
      const loaded = await loadFirstReachableUrl(win);
      if (!loaded && !win.isDestroyed()) {
        recordStartupEvent('renderer-recovery-waiting');
        await loadErrorFallback(win);
        scheduleRendererRecovery();
      }
      if (loaded) {
        isShowingRendererFallback = false;
      }
    } finally {
      recovering = false;
    }
  };

  if (isDev) {
    recordStartupEvent('load-started', { source: 'dev-url' });
    win.loadURL(devUrl);
  } else if (fs.existsSync(standaloneRendererServer)) {
    recordStartupEvent('load-started', { source: 'renderer-standalone' });
    startStandaloneRenderer()
      .then(async (info) => {
        if (!info) throw new Error('Renderer standalone missing');
        const standaloneUrl = `http://127.0.0.1:${info.port}/`;
        const loaded = await loadUrlWithRetries(win, standaloneUrl);
        if (loaded) {
          isShowingRendererFallback = false;
          return;
        }
        throw new Error('Renderer standalone unreachable');
      })
      .catch(async (error) => {
        recordStartupEvent('renderer-standalone-failed', { error: String(error?.message || error) });
        await recoverRenderer();
      });
  } else if (fs.existsSync(rendererIndex)) {
    recordStartupEvent('load-started', { source: 'renderer-index' });
    win.loadFile(rendererIndex);
  } else if (fs.existsSync(legacyRendererIndex)) {
    recordStartupEvent('load-started', { source: 'legacy-renderer-index' });
    win.loadFile(legacyRendererIndex);
  } else {
    recordStartupEvent('renderer-missing');
    recoverRenderer();
  }

  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    const currentUrl = win.webContents.getURL();
    if (typeof currentUrl === 'string' && currentUrl.startsWith('data:text/html')) {
      return;
    }
    recordStartupEvent('did-fail-load', { url: validatedURL, error: `${errorCode}:${errorDescription}` });
    recoverRenderer().catch(() => {});
  });

  win.webContents.on('did-finish-load', () => {
    recordStartupEvent('did-finish-load', { url: win.webContents.getURL() });
    if (!win.isVisible()) {
      win.show();
      recordStartupEvent('window-shown');
    }
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
  recordStartupEvent('app-ready');
  installMainProcessErrorHandlers();
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = { ...(details.responseHeaders || {}) };
    const url = details.url;
    const isMainFrame = details.resourceType === 'mainFrame';
    if (isMainFrame && isInternalAppUrl(url)) {
      responseHeaders['Content-Security-Policy'] = [isDev ? rendererCspDev : rendererCsp];
    }
    callback({ responseHeaders });
  });
  settingsCache = readSettings();
  createWindow();
  if (shouldRewriteSettingsOnStartup()) {
    enqueueSettingsWrite((settings) => {
      Object.assign(settings, settingsCache);
    }).catch(() => {});
  }

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

app.on('before-quit', () => {
  if (rendererServer) {
    try {
      rendererServer.kill();
    } catch {}
    rendererServer = null;
    rendererServerPort = 0;
  }
});

const broadcast = (channel, payload) => {
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send(channel, payload);
  });
};

ipcMain.handle('mlc:get-models', async (event) => {
  assertTrustedIpcSender(event);
  const baseDir = app.getPath('userData');
  const { getModels } = getMlcModule();
  return getModels(baseDir);
});

ipcMain.handle('mlc:search-models', async (event, payload) => {
  assertTrustedIpcSender(event);
  const { searchModels } = getMlcModule();
  return searchModels(payload?.query || '');
});

ipcMain.handle('mlc:get-model-files', async (event, payload) => {
  assertTrustedIpcSender(event);
  const { getModelFiles } = getMlcModule();
  return getModelFiles(payload?.modelId || '');
});

ipcMain.handle('mlc:download', async (event, payload) => {
  assertTrustedIpcSender(event);
  const baseDir = app.getPath('userData');
  const { downloadAndConvert } = getMlcModule();
  const startedAt = Date.now();
  let progressEventCount = 0;
  try {
    const result = await downloadAndConvert(baseDir, payload, (progress) => {
      progressEventCount += 1;
      broadcast('mlc:download-progress', { id: payload?.id, progress });
    });
    recordAiDownloadSample({
      durationMs: Date.now() - startedAt,
      progressEventCount,
      modelId: payload?.id || payload?.modelId,
      ok: true,
    });
    return result;
  } catch (error) {
    recordAiDownloadSample({
      durationMs: Date.now() - startedAt,
      progressEventCount,
      modelId: payload?.id || payload?.modelId,
      ok: false,
    });
    throw error;
  }
});

ipcMain.handle('mlc:delete', async (event, payload) => {
  assertTrustedIpcSender(event);
  const baseDir = app.getPath('userData');
  const { deleteModel } = getMlcModule();
  return deleteModel(baseDir, payload?.id);
});

ipcMain.handle('mlc:chat', async (event, payload) => {
  assertTrustedIpcSender(event);
  const baseDir = app.getPath('userData');
  const { runChat } = getMlcModule();
  const startedAt = Date.now();
  let tokenCount = 0;
  try {
    const result = await runChat(baseDir, payload, (token) => {
      tokenCount += 1;
      broadcast('mlc:chat-token', { chatId: payload?.chatId, token });
    });
    recordAiChatSample({
      durationMs: Date.now() - startedAt,
      tokenCount,
      chatId: payload?.chatId,
      ok: true,
    });
    return result;
  } catch (error) {
    recordAiChatSample({
      durationMs: Date.now() - startedAt,
      tokenCount,
      chatId: payload?.chatId,
      ok: false,
    });
    throw error;
  }
});

ipcMain.handle('mlc:cancel-chat', async (event, payload) => {
  assertTrustedIpcSender(event);
  const { cancelChat } = getMlcModule();
  return cancelChat(payload?.chatId);
});

ipcMain.handle('settings:get', async (event, key) => {
  assertTrustedIpcSender(event);
  if (!isSafeSettingKey(key)) return null;
  if (isSensitiveSessionKey(key)) return null;
  const settings = getEffectiveSettingsSnapshot();
  return settings[key];
});

ipcMain.handle('settings:set', async (event, payload) => {
  assertTrustedIpcSender(event);
  const key = payload?.key;
  if (!isSafeSettingKey(key)) return false;
  if (isSensitiveSessionKey(key)) return false;
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

ipcMain.handle('settings:get-many', async (event, keys) => {
  assertTrustedIpcSender(event);
  const safeKeys = filterSafeSettingKeys(keys);
  const settings = getEffectiveSettingsSnapshot();
  return safeKeys.reduce((acc, key) => {
    acc[key] = settings[key];
    return acc;
  }, {});
});

ipcMain.handle('settings:set-many', async (event, entries) => {
  assertTrustedIpcSender(event);
  const safeEntries = filterSafeSettingEntries(entries);
  if (safeEntries.length === 0) return false;
  await enqueueSettingsWrite((settings) => {
    safeEntries.forEach(([key, value]) => {
      if (value === null || value === undefined) {
        delete settings[key];
      } else {
        settings[key] = value;
      }
    });
  });
  return true;
});

ipcMain.handle('session:get', async (event) => {
  assertTrustedIpcSender(event);
  const settings = getEffectiveSettingsSnapshot();
  return {
    token: typeof settings.token === 'string' ? settings.token : null,
    user: settings.user ?? null,
  };
});

ipcMain.handle('session:set', async (event, payload) => {
  assertTrustedIpcSender(event);
  const nextToken = typeof payload?.token === 'string' ? payload.token : null;
  const nextUser = payload?.user ?? null;
  await enqueueSettingsWrite((settings) => {
    if (nextToken) {
      settings.token = nextToken;
    } else {
      delete settings.token;
    }
    if (nextUser !== null && nextUser !== undefined) {
      settings.user = nextUser;
    } else {
      delete settings.user;
    }
  });
  return true;
});

ipcMain.handle('http:request', async (event, payload) => {
  assertTrustedIpcSender(event);
  const url = typeof payload?.url === 'string' ? payload.url : '';
  const method = String(payload?.method || 'GET').toUpperCase();
  if (!isAllowedHttpBridgeUrl(url)) {
    throw new Error('Invalid URL');
  }
  if (!allowedHttpBridgeMethods.has(method)) {
    throw new Error('Invalid method');
  }
  const body = typeof payload?.body === 'string' ? payload.body : undefined;
  if (body && body.length > 1024 * 1024) {
    throw new Error('Request body too large');
  }
  const headers = sanitizeBridgeRequestHeaders(url, payload?.headers);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  const response = await fetch(url, {
    method,
    headers,
    credentials: 'omit',
    redirect: 'manual',
    signal: controller.signal,
    ...(body !== undefined ? { body } : {}),
  }).finally(() => clearTimeout(timeout));
  if (response.status >= 300 && response.status < 400) {
    throw new Error('Redirects are not allowed');
  }
  const readLimitedText = async (res) => {
    const maxBytes = 2 * 1024 * 1024;
    const reader = res.body?.getReader?.();
    if (!reader) return '';
    const chunks = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      received += chunk.length;
      if (received > maxBytes) {
        try {
          await reader.cancel();
        } catch {}
        throw new Error('Response too large');
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf8');
  };
  const bodyText = await readLimitedText(response);
  return {
    ok: response.ok,
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    bodyText,
  };
});

ipcMain.handle('perf:get-snapshot', async (event) => {
  assertTrustedIpcSender(event);
  return getElectronPerformanceSnapshot();
});
ipcMain.handle('perf:reset-snapshot', async (event) => {
  assertTrustedIpcSender(event);
  resetElectronPerformanceSnapshot();
  return true;
});
