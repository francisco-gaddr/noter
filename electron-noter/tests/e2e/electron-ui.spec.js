const path = require('path');
const { spawn } = require('child_process');
const http = require('http');
const { _electron: electron } = require('playwright');
const { test, expect } = require('@playwright/test');

const webDir = path.join(__dirname, '..', '..', '..', 'noter-app', 'apps', 'web');
const electronRoot = path.join(__dirname, '..', '..');
const devUrl = 'http://localhost:3001/app/';

let webProcess;
let lmServer;
let lmPort = 0;
let uiAvailable = true;
const uiEnabled = process.env.E2E_UI === '1';

const fetchWithTimeout = async (url, timeoutMs) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { method: 'GET', signal: controller.signal, redirect: 'manual' });
  } finally {
    clearTimeout(timer);
  }
};

const isServerUp = async () => {
  try {
    const res = await fetchWithTimeout(devUrl, 2000);
    return res.ok || (res.status >= 300 && res.status < 400);
  } catch {
    return false;
  }
};

const waitForServer = async () => {
  const start = Date.now();
  while (Date.now() - start < 120000) {
    try {
      const res = await fetchWithTimeout(devUrl, 1000);
      if (res.ok || (res.status >= 300 && res.status < 400)) return true;
    } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
};

test.beforeAll(async () => {
  if (!uiEnabled) {
    uiAvailable = false;
    return;
  }
  lmServer = http.createServer((req, res) => {
    if (req.url.startsWith('/api/v1/models')) {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ models: [{ key: 'lmstudio-test', display_name: 'LM Studio Test' }] }));
      return;
    }
    if (req.url.startsWith('/api/v1/chat')) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });
      res.write(`data: ${JSON.stringify({ output: [{ type: 'message', content: '<thinking>Planerar svar</thinking>Hej från LM' }] })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve, reject) => {
    lmServer.listen(0, () => {
      const address = lmServer.address();
      lmPort = typeof address === 'object' && address ? address.port : 0;
      resolve();
    });
    lmServer.on('error', reject);
  });

  if (!(await isServerUp())) {
    webProcess = spawn('npm', ['run', 'dev'], { cwd: webDir, stdio: 'inherit', shell: true });
    const ready = await waitForServer();
    if (!ready) {
      uiAvailable = false;
    }
  }
});

test.afterAll(() => {
  if (webProcess) {
    webProcess.kill();
  }
  if (lmServer) {
    lmServer.close();
  }
});

test('loads main UI from dev server', async () => {
  test.skip(!uiAvailable, 'UI not available');
  const app = await electron.launch({
    args: [path.join(electronRoot, 'main.js')],
    env: { ...process.env, NODE_ENV: 'development' },
  });
  const page = await app.firstWindow();
  await page.waitForTimeout(3000);
  await expect(page).toHaveTitle(/Noter/i, { timeout: 20000 });
  await app.close();
});

test('lm studio chat flow works', async () => {
  test.skip(!uiAvailable, 'UI not available');
  const app = await electron.launch({
    args: [path.join(electronRoot, 'main.js')],
    env: { ...process.env, NODE_ENV: 'development' },
  });
  const page = await app.firstWindow();
  await page.waitForTimeout(2000);

  await page.evaluate(() => {
    localStorage.setItem('token', 'test-token');
    localStorage.setItem('user', JSON.stringify({ _id: 'user-1', username: 'test' }));
  });
  await page.reload();

  await page.getByLabel('Open AI Assistant').click();
  await page.getByLabel('Öppna AI-inställningar').click();
  await page.selectOption('[data-testid="ai-provider-select"]', 'lmstudio');
  await page.fill('[data-testid="lmstudio-base-url"]', `http://localhost:${lmPort}`);
  await page.click('[data-testid="lmstudio-refresh-models"]');
  await page.selectOption('[data-testid="lmstudio-model-select"]', 'lmstudio-test');

  await page.getByLabel('Öppna AI-inställningar').click();
  await page.fill('[data-testid="ai-chat-input"]', 'Hej');
  await page.click('[data-testid="ai-chat-send"]');

  await expect(page.getByText('Visa tänkande')).toBeVisible({ timeout: 10000 });
  await expect(page.getByText('Hej från LM')).toBeVisible({ timeout: 10000 });
  await app.close();
});

test('project folders and new chat are available', async () => {
  test.skip(!uiAvailable, 'UI not available');
  const app = await electron.launch({
    args: [path.join(electronRoot, 'main.js')],
    env: { ...process.env, NODE_ENV: 'development' },
  });
  const page = await app.firstWindow();
  await page.waitForTimeout(2000);

  await page.evaluate(() => {
    localStorage.setItem('token', 'test-token');
    localStorage.setItem('user', JSON.stringify({ _id: 'user-1', username: 'test' }));
  });
  await page.reload();

  await page.getByLabel('Open AI Assistant').click();
  await page.getByLabel('Öppna AI-meny').click();
  await page.getByText('Nytt projekt').click();
  await page.fill('[data-testid="ai-project-name"]', 'Projekt A');
  await page.fill('[data-testid="ai-project-prompt"]', 'System för projekt A');
  await page.click('[data-testid="ai-project-save"]');
  await expect(page.getByText('Projekt A')).toBeVisible();
  await page.getByText('Projekt A').click();
  await page.getByLabel('Ny chatt').click();
  await page.getByLabel('Öppna AI-meny').click();
  await expect(page.getByText('New Chat')).toBeVisible();

  await app.close();
});
