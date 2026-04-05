const { spawn } = require('child_process');
const path = require('path');

const webDir = path.join(__dirname, '..', '..', 'noter-app', 'apps', 'web');
const electronBin = path.join(__dirname, '..', 'node_modules', '.bin', 'electron');
let web = null;

const fetchWithTimeout = async (url, timeoutMs) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { method: 'GET', signal: controller.signal, redirect: 'manual' });
  } finally {
    clearTimeout(timer);
  }
};

const waitForServer = async () => {
  const url = process.env.ELECTRON_RENDERER_URL || 'http://localhost:3001/';
  const start = Date.now();
  while (Date.now() - start < 60000) {
    try {
      const res = await fetchWithTimeout(url, 1000);
      if (res.ok || (res.status >= 300 && res.status < 400)) return true;
    } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
};

const startElectron = async () => {
  const rendererUrl = process.env.ELECTRON_RENDERER_URL || 'http://localhost:3001/';
  const alreadyRunning = await fetchWithTimeout(rendererUrl, 1000)
    .then((res) => res.ok || (res.status >= 300 && res.status < 400))
    .catch(() => false);
  if (!alreadyRunning) {
    web = spawn('npm', ['run', 'dev'], { 
      cwd: webDir, 
      stdio: 'inherit', 
      shell: true,
      env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=8192' }
    });
  }
  await waitForServer();
  spawn(electronBin, ['.'], {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      ELECTRON_RENDERER_URL: rendererUrl,
    },
  });
};

startElectron();

process.on('exit', () => {
  web?.kill();
});
