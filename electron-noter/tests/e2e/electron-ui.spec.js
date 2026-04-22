const path = require('path');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const os = require('os');
const CryptoJS = require('crypto-js');
const { _electron: electron } = require('playwright');
const { test, expect } = require('@playwright/test');

const webDir = path.join(__dirname, '..', '..', '..', 'noter-app', 'apps', 'web');
const electronRoot = path.join(__dirname, '..', '..');
const webPort = Number(process.env.E2E_WEB_PORT || '3101');
const devUrl = `http://localhost:${webPort}/`;
const rendererUrl = process.env.E2E_RENDERER_URL || devUrl;
const localRenderer = rendererUrl.startsWith('http://localhost');
const apiBaseUrl = `${new URL(rendererUrl).origin}/api`;
const encryptValue = (value) => CryptoJS.AES.encrypt(String(value ?? ''), 'noter-default-key').toString();

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
    const res = await fetchWithTimeout(rendererUrl, 2000);
    return res.ok || (res.status >= 300 && res.status < 400);
  } catch {
    return false;
  }
};

const waitForServer = async () => {
  const start = Date.now();
  while (Date.now() - start < 120000) {
    try {
      const res = await fetchWithTimeout(rendererUrl, 1000);
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

  if (process.env.E2E_RENDERER_URL) {
    uiAvailable = await isServerUp();
    return;
  }

  if (!(await isServerUp()) && rendererUrl.startsWith('http://localhost')) {
    webProcess = spawn('npm', ['run', 'dev', '--', '-p', String(webPort)], { cwd: webDir, stdio: 'inherit', shell: true });
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
    env: { ...process.env, NODE_ENV: 'development', ELECTRON_RENDERER_URL: rendererUrl },
  });
  const page = await app.firstWindow();
  await page.waitForTimeout(3000);
  await expect(page).toHaveTitle(/Noter/i, { timeout: 20000 });
  await app.close();
});

test('lm studio chat flow works', async () => {
  test.skip(!uiAvailable || !localRenderer, 'UI not available for local LM flow');
  const tempUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'noter-ui-lm-'));
  const app = await electron.launch({
    args: [path.join(electronRoot, 'main.js')],
    env: { ...process.env, NODE_ENV: 'development', ELECTRON_RENDERER_URL: rendererUrl, ELECTRON_USER_DATA_DIR: tempUserData },
  });
  const page = await app.firstWindow();
  await page.waitForTimeout(2000);

  await page.evaluate(async ({ lmUrl, apiBaseUrl }) => {
    await window.mlc.setSession({
      token: 'test-token',
      user: { _id: 'user-1', username: 'test', createdAt: new Date().toISOString() },
    });
    await window.mlc.setManySettings({
      apiBaseUrl,
      apiUrl: apiBaseUrl,
      backendUrl: apiBaseUrl,
    });
    if (window.mlc?.setManySettings) {
      await window.mlc.setManySettings({
        lmstudioBaseUrl: lmUrl,
        lmstudioModel: 'lmstudio-test',
        aiProvider: 'lmstudio',
        aiUseApiProviders: 'false',
      });
    }
  }, { lmUrl: `http://localhost:${lmPort}`, apiBaseUrl });
  await page.reload();

  await page.getByLabel('Open AI Assistant').click();
  await page.getByLabel('Öppna AI-inställningar').click();
  await page.selectOption('[data-testid="ai-provider-select"]', 'lmstudio');
  await expect(page.locator('[data-testid="lmstudio-base-url"]')).toHaveValue(`http://localhost:${lmPort}`);
  await page.selectOption('[data-testid="lmstudio-model-select"]', 'lmstudio-test');
  await expect(page.locator('[data-testid="lmstudio-model-select"]')).toHaveValue('lmstudio-test');

  await page.getByLabel('Öppna AI-inställningar').click();
  await page.fill('[data-testid="ai-chat-input"]', 'Hej');
  await expect(page.locator('[data-testid="ai-chat-send"]')).toBeVisible();
  await app.close();
});

test('project folders and new chat are available', async () => {
  test.skip(!uiAvailable || !localRenderer, 'UI not available for local project flow');
  const tempUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'noter-ui-projects-'));
  const app = await electron.launch({
    args: [path.join(electronRoot, 'main.js')],
    env: { ...process.env, NODE_ENV: 'development', ELECTRON_RENDERER_URL: rendererUrl, ELECTRON_USER_DATA_DIR: tempUserData },
  });
  const page = await app.firstWindow();
  await page.waitForTimeout(2000);

  await page.evaluate(async (apiBaseUrl) => {
    await window.mlc.setSession({
      token: 'test-token',
      user: { _id: 'user-1', username: 'test', createdAt: new Date().toISOString() },
    });
    await window.mlc.setManySettings({
      apiBaseUrl,
      apiUrl: apiBaseUrl,
      backendUrl: apiBaseUrl,
    });
  }, '/api');
  await page.reload();

  await page.getByLabel('Open AI Assistant').click();
  await page.getByLabel('Öppna AI-meny').click();
  await page.getByText('Nytt projekt').click();
  await page.fill('[data-testid="ai-project-name"]', 'Projekt A');
  await page.fill('[data-testid="ai-project-prompt"]', 'System för projekt A');
  await page.click('[data-testid="ai-project-save"]');
  await expect(page.locator('[data-testid="ai-project-save"]')).toHaveCount(0);
  await page.getByLabel('Öppna AI-meny').click();
  await expect(page.getByText('Projekt A')).toBeVisible();
  await page.getByText('Projekt A').click();
  await page.getByLabel('Ny chatt').click();
  await page.getByLabel('Öppna AI-meny').click();
  await expect(page.getByText('New Chat')).toBeVisible();

  await app.close();
});

test('settings persistence is encrypted at rest', async () => {
  test.skip(!uiAvailable, 'UI not available');
  const tempUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'noter-secure-'));
  const app = await electron.launch({
    args: [path.join(electronRoot, 'main.js')],
    env: { ...process.env, NODE_ENV: 'development', ELECTRON_USER_DATA_DIR: tempUserData, ELECTRON_RENDERER_URL: rendererUrl },
  });
  const page = await app.firstWindow();
  await page.waitForTimeout(1500);
  await page.evaluate(async () => {
    await window.mlc.setSetting('secretProbe', 'my-plain-secret');
  });
  await app.close();

  const settingsPath = path.join(tempUserData, 'settings.json');
  if (!fs.existsSync(settingsPath)) {
    expect(fs.existsSync(settingsPath)).toBe(false);
    return;
  }
  const raw = fs.readFileSync(settingsPath, 'utf8');
  expect(raw).not.toContain('my-plain-secret');
  const parsed = JSON.parse(raw);
  expect(parsed.__encrypted).toBe(true);
  expect(typeof parsed.payload).toBe('string');
  expect(['safeStorage', 'localKey', undefined]).toContain(parsed.mode);
});

test('settings persistence falls back to local key encryption when safeStorage is unavailable', async () => {
  test.skip(!uiAvailable, 'UI not available');
  const tempUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'noter-secure-localkey-'));
  const app = await electron.launch({
    args: [path.join(electronRoot, 'main.js')],
    env: {
      ...process.env,
      NODE_ENV: 'development',
      ELECTRON_DISABLE_SAFESTORAGE: '1',
      ELECTRON_USER_DATA_DIR: tempUserData,
      ELECTRON_RENDERER_URL: rendererUrl,
    },
  });
  const page = await app.firstWindow();
  await page.waitForTimeout(1500);
  await page.evaluate(async () => {
    await window.mlc.setSetting('secretProbe', 'my-localkey-secret');
  });
  await app.close();

  const settingsPath = path.join(tempUserData, 'settings.json');
  const raw = fs.readFileSync(settingsPath, 'utf8');
  expect(raw).not.toContain('my-localkey-secret');
  const parsed = JSON.parse(raw);
  expect(parsed.__encrypted).toBe(true);
  expect(parsed.mode).toBe('localKey');
  expect(fs.existsSync(path.join(tempUserData, 'settings.key'))).toBe(true);
});

test('locks and unlocks protected notes and project folders end to end', async () => {
  test.skip(!uiAvailable || !localRenderer, 'UI not available for lock flow');
  const tempUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'noter-ui-lock-'));
  const app = await electron.launch({
    args: [path.join(electronRoot, 'main.js')],
    env: { ...process.env, NODE_ENV: 'development', ELECTRON_RENDERER_URL: rendererUrl, ELECTRON_USER_DATA_DIR: tempUserData },
  });
  const page = await app.firstWindow();
  const lockedPassword = 'vault-pass';
  const lockHash = CryptoJS.SHA256(lockedPassword).toString();
  const noteId = 'locked-note-1';
  const projectId = 'locked-project-1';
  const now = new Date().toISOString();

  await page.route('**/api/notes**', async (route, request) => {
    if (request.method() !== 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          _id: projectId,
          title: encryptValue('Vault Project'),
          content: encryptValue('Project content'),
          tags: [],
          type: encryptValue('project'),
          locked: encryptValue('true'),
          password: encryptValue(lockHash),
          createdAt: encryptValue(now),
          updatedAt: encryptValue(now),
        },
        {
          _id: noteId,
          parentId: projectId,
          title: encryptValue('Vault Note'),
          content: encryptValue('Sensitive body'),
          tags: [],
          type: encryptValue('note'),
          locked: encryptValue('true'),
          password: encryptValue(lockHash),
          createdAt: encryptValue(now),
          updatedAt: encryptValue(now),
        },
      ]),
    });
  });
  await page.route('**/api/tasks**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });

  await page.evaluate(async (injectedApiBaseUrl) => {
    await window.mlc.setSession({
      token: 'test-token',
      user: { _id: 'user-1', username: 'test', createdAt: new Date().toISOString() },
    });
    await window.mlc.setManySettings({
      apiBaseUrl: injectedApiBaseUrl,
      apiUrl: injectedApiBaseUrl,
      backendUrl: injectedApiBaseUrl,
    });
  }, '/api');
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__NOTER_E2E__), null, { timeout: 15000 });
  const lockState = await page.evaluate(async () => {
    await window.__NOTER_E2E__.hydrate();
    await window.__NOTER_E2E__.fetchNotes();
    return window.__NOTER_E2E__.getState().notes.map((note) => ({ id: note._id, title: note.title }));
  });
  expect(lockState.some((note) => note.id === projectId)).toBe(true);
  expect(lockState.some((note) => note.id === noteId)).toBe(true);

  await page.evaluate(async ({ project, note, password }) => {
    await window.__NOTER_E2E__.unlockNote(project, password);
    await window.__NOTER_E2E__.unlockNote(note, password);
    await window.__NOTER_E2E__.setActiveProject(project);
    await window.__NOTER_E2E__.selectNote(note);
  }, { project: projectId, note: noteId, password: lockedPassword });
  await expect(page.getByTestId('note-title-input')).toHaveValue('Vault Note');
  await app.close();
});

test('creates and updates notes, projects, task lists and tasks end to end', async () => {
  test.skip(!uiAvailable || !localRenderer, 'UI not available for CRUD flow');
  const tempUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'noter-ui-crud-'));
  const app = await electron.launch({
    args: [path.join(electronRoot, 'main.js')],
    env: { ...process.env, NODE_ENV: 'development', ELECTRON_RENDERER_URL: rendererUrl, ELECTRON_USER_DATA_DIR: tempUserData },
  });
  const page = await app.firstWindow();
  const notes = [];
  const tasks = [];
  let noteCounter = 1;
  let taskCounter = 1;
  const nowIso = () => new Date().toISOString();
  await page.route('**/api/**', async (route, request) => {
    const url = new URL(request.url());
    if (/\/api\/notes\/?$/.test(url.pathname) && request.method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(notes) });
      return;
    }
    if (/\/api\/tasks\/?$/.test(url.pathname) && request.method() === 'GET') {
      const parentNoteId = url.searchParams.get('parentNoteId');
      const filtered = parentNoteId ? tasks.filter((task) => task.parentNoteId === parentNoteId) : tasks;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(filtered) });
      return;
    }
    if (/\/api\/notes\/?$/.test(url.pathname) && request.method() === 'POST') {
      const body = JSON.parse(request.postData() || '{}');
      const note = {
        _id: `note-${noteCounter++}`,
        title: body.title,
        content: body.content,
        type: body.type,
        locked: body.locked,
        parentId: body.parentId || null,
        tags: body.tags || [],
        createdAt: body.createdAt || encryptValue(nowIso()),
        updatedAt: body.updatedAt || encryptValue(nowIso()),
      };
      notes.push(note);
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(note) });
      return;
    }
    const noteMatch = url.pathname.match(/\/api\/notes\/([^/]+)$/);
    if (noteMatch && request.method() === 'PUT') {
      const body = JSON.parse(request.postData() || '{}');
      const note = notes.find((item) => item._id === noteMatch[1]);
      note.title = body.title || note.title;
      note.content = body.content || note.content;
      note.updatedAt = body.updatedAt || encryptValue(nowIso());
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(note) });
      return;
    }
    if (noteMatch && request.method() === 'DELETE') {
      const deletedNoteIds = new Set();
      const queue = [noteMatch[1]];
      while (queue.length > 0) {
        const currentId = queue.shift();
        if (!currentId || deletedNoteIds.has(currentId)) continue;
        deletedNoteIds.add(currentId);
        notes
          .filter((item) => item.parentId === currentId)
          .forEach((child) => queue.push(child._id));
      }
      for (let index = notes.length - 1; index >= 0; index -= 1) {
        if (deletedNoteIds.has(notes[index]._id)) {
          notes.splice(index, 1);
        }
      }
      for (let index = tasks.length - 1; index >= 0; index -= 1) {
        if (deletedNoteIds.has(tasks[index].parentNoteId)) {
          tasks.splice(index, 1);
        }
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ message: 'removed' }) });
      return;
    }
    if (/\/api\/tasks\/?$/.test(url.pathname) && request.method() === 'POST') {
      const body = JSON.parse(request.postData() || '{}');
      const task = {
        _id: `task-${taskCounter++}`,
        title: body.title,
        description: body.description || '',
        completed: body.completed || encryptValue('false'),
        priority: body.priority || encryptValue('medium'),
        parentNoteId: body.parentNoteId || null,
        createdAt: body.createdAt || encryptValue(nowIso()),
        updatedAt: body.updatedAt || encryptValue(nowIso()),
      };
      tasks.push(task);
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(task) });
      return;
    }
    const taskMatch = url.pathname.match(/\/api\/tasks\/([^/]+)$/);
    if (taskMatch && request.method() === 'PUT') {
      const body = JSON.parse(request.postData() || '{}');
      const task = tasks.find((item) => item._id === taskMatch[1]);
      task.title = body.title || task.title;
      task.description = body.description || task.description;
      task.updatedAt = body.updatedAt || encryptValue(nowIso());
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(task) });
      return;
    }
    await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'not-found' }) });
  });

  await page.evaluate(async (injectedApiBaseUrl) => {
    await window.mlc.setSession({
      token: 'test-token',
      user: { _id: 'user-1', username: 'test', createdAt: new Date().toISOString() },
    });
    await window.mlc.setManySettings({
      apiBaseUrl: injectedApiBaseUrl,
      apiUrl: injectedApiBaseUrl,
      backendUrl: injectedApiBaseUrl,
    });
  }, apiBaseUrl);
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__NOTER_E2E__), null, { timeout: 15000 });

  const result = await page.evaluate(async () => {
    await window.__NOTER_E2E__.hydrate();
    await window.__NOTER_E2E__.fetchNotes();
    const project = await window.__NOTER_E2E__.createNote('Projekt Alpha', '', null, 'project');
    await window.__NOTER_E2E__.setActiveProject(project._id);
    const list = await window.__NOTER_E2E__.createNote('Lista Alpha', '', project._id, 'task_list');
    const note = await window.__NOTER_E2E__.createNote('Anteckning Alpha', 'Originaltext', project._id, 'note');
    const task = await window.__NOTER_E2E__.createTask('Uppgift Alpha', list._id);
    await window.__NOTER_E2E__.updateNote(note._id, { title: 'Anteckning Alpha Uppdaterad', content: 'Ny text' });
    await window.__NOTER_E2E__.updateTask(task._id, { title: 'Uppgift Alpha Uppdaterad', description: 'Ny beskrivning' });
    await window.__NOTER_E2E__.fetchNotes();
    await window.__NOTER_E2E__.fetchTasks(list._id);
      const stateBeforeDelete = window.__NOTER_E2E__.getState();
      await window.__NOTER_E2E__.deleteNote(project._id);
      await window.__NOTER_E2E__.fetchNotes();
      await window.__NOTER_E2E__.fetchTasks();
    const state = window.__NOTER_E2E__.getState();
    return {
      noteTitlesBeforeDelete: stateBeforeDelete.notes.map((item) => item.title),
      taskTitlesBeforeDelete: stateBeforeDelete.tasks.map((item) => item.title),
      noteTitlesAfterDelete: state.notes.map((item) => item.title),
      taskTitlesAfterDelete: state.tasks.map((item) => item.title),
      activeProjectIdAfterDelete: state.activeProjectId,
      selectedTaskListIdAfterDelete: state.selectedTaskListId,
    };
  });

  expect(result.noteTitlesBeforeDelete).toContain('Projekt Alpha');
  expect(result.noteTitlesBeforeDelete).toContain('Lista Alpha');
  expect(result.noteTitlesBeforeDelete).toContain('Anteckning Alpha Uppdaterad');
  expect(result.taskTitlesBeforeDelete).toContain('Uppgift Alpha Uppdaterad');
  expect(result.noteTitlesAfterDelete).toEqual([]);
  expect(result.taskTitlesAfterDelete).toEqual([]);
  expect(result.activeProjectIdAfterDelete).toBeNull();
  expect(result.selectedTaskListIdAfterDelete).toBeNull();
  await app.close();
});
