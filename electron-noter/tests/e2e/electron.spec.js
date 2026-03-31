const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const { _electron: electron } = require('playwright');
const { test, expect } = require('@playwright/test');

const createUserDataDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'noter-electron-'));
let lmServer;
let lmPort = 0;
const e2eEnabled = process.env.E2E_ELECTRON === '1';

test.beforeAll(async () => {
  if (!e2eEnabled) return;
  lmServer = http.createServer((req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      res.end();
      return;
    }
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
      res.write(`data: ${JSON.stringify({ output: [{ type: 'message', content: 'Hej från LM' }] })}\n\n`);
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
});

test.afterAll(() => {
  if (lmServer) lmServer.close();
});

test('loads preload and exposes mlc bridge', async () => {
  test.skip(!e2eEnabled, 'E2E_ELECTRON not enabled');
  const userDataDir = createUserDataDir();
  const app = await electron.launch({
    args: [path.join(__dirname, '..', '..', 'main.js')],
    env: { ...process.env, ELECTRON_TEST: '1', ELECTRON_USER_DATA_DIR: userDataDir },
  });
  const page = await app.firstWindow({ timeout: 20000 });
  await page.waitForTimeout(1000);
  const title = await page.title();
  const bridge = await page.getAttribute('body', 'data-mlc');
  expect(title).toBe('Electron Noter Test');
  expect(bridge).toBe('ready');
  await app.close();
});

test('runs mocked download and chat flow', async () => {
  test.skip(!e2eEnabled, 'E2E_ELECTRON not enabled');
  const userDataDir = createUserDataDir();
  const app = await electron.launch({
    args: [path.join(__dirname, '..', '..', 'main.js')],
    env: { ...process.env, ELECTRON_TEST: '1', MLC_MOCK: '1', ELECTRON_USER_DATA_DIR: userDataDir },
  });
  const page = await app.firstWindow({ timeout: 20000 });
  await page.evaluate(async () => {
    await window.mlc.resetPerformanceSnapshot();
    const models = await window.mlc.getModels();
    if (models.length !== 0) throw new Error('Expected empty models');
    await window.mlc.downloadAndConvert({ id: 'mock:Q4_K_M', modelId: 'mock', ggufUrl: 'https://example.test/mock.gguf', quant: 'Q4_K_M', target: 'cuda' });
    const updated = await window.mlc.getModels();
    if (!updated.length) throw new Error('Expected model after download');
    const tokenPromise = new Promise((resolve) => {
      const unsub = window.mlc.onChatToken((data) => {
        if (data?.token) {
          unsub?.();
          resolve(true);
        }
      });
    });
    const chatPromise = window.mlc.chat({ chatId: 'chat-1', modelPath: updated[0].path, prompt: 'Hej' }).then(() => true);
    const timeoutPromise = new Promise((resolve, reject) => {
      setTimeout(() => reject(new Error('No tokens received')), 2000);
    });
    await Promise.race([tokenPromise, chatPromise, timeoutPromise]);
  });
  const snapshot = await page.evaluate(() => window.mlc.getPerformanceSnapshot());
  expect(snapshot.ai.downloads.count).toBeGreaterThanOrEqual(1);
  expect(snapshot.ai.downloads.lastProgressEventCount).toBeGreaterThanOrEqual(1);
  expect(snapshot.ai.chats.count).toBeGreaterThanOrEqual(1);
  expect(snapshot.ai.chats.lastTokenCount).toBeGreaterThanOrEqual(1);
  await app.close();
});

test('lm studio streaming chat works in renderer', async () => {
  test.skip(!e2eEnabled, 'E2E_ELECTRON not enabled');
  const userDataDir = createUserDataDir();
  const app = await electron.launch({
    args: [path.join(__dirname, '..', '..', 'main.js')],
    env: { ...process.env, ELECTRON_TEST: '1', ELECTRON_USER_DATA_DIR: userDataDir },
  });
  const page = await app.firstWindow({ timeout: 20000 });
  const result = await page.evaluate(async (port) => {
    const res = await fetch(`http://localhost:${port}/api/v1/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'lmstudio-test', input: 'Hej', stream: true }),
    });
    const reader = res.body?.getReader();
    if (!reader) return null;
    const decoder = new TextDecoder();
    let buffer = '';
    let text = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value);
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.replace(/^data:\s*/, '');
        if (payload === '[DONE]') break;
        try {
          const json = JSON.parse(payload);
          const output = json.output?.find((o) => o.type === 'message')?.content || '';
          if (output) text = output;
        } catch {}
      }
    }
    return text;
  }, lmPort);
  expect(result).toBe('Hej från LM');
  await app.close();
});
