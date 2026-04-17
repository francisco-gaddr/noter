const path = require('path');
const os = require('os');
const fs = require('fs');
const CryptoJS = require('crypto-js');
const { _electron: electron } = require('playwright');

const rendererUrl = process.env.E2E_RENDERER_URL || 'http://localhost:3001/';
const apiBaseUrl = `${new URL(rendererUrl).origin}/api`;
const electronRoot = path.join(__dirname, '..', '..');

const now = new Date().toISOString();
const encrypt = (value) => CryptoJS.AES.encrypt(String(value), 'noter-default-key').toString();

const notes = [
  { _id: 'p1', title: 'Projekt Låst', content: '', type: 'project', parentId: null, locked: 'true', tags: [], createdAt: now, updatedAt: now },
  { _id: 'sp1', title: 'Underprojekt', content: '', type: 'project', parentId: 'p1', locked: 'false', tags: [], createdAt: now, updatedAt: now },
  { _id: 'n1', title: 'Anteckning i projekt', content: 'Projekthemlighet', type: 'note', parentId: 'p1', locked: 'false', tags: [], createdAt: now, updatedAt: now },
  { _id: 'n4', title: 'Djup anteckning', content: 'Djup projekthemlighet', type: 'note', parentId: 'sp1', locked: 'false', tags: [], createdAt: now, updatedAt: now },
  { _id: 'n2', title: 'Rothemlighet', content: 'Hemlig rottext', type: 'note', parentId: null, locked: 'true', tags: [], createdAt: now, updatedAt: now },
  { _id: 'n3', title: 'Öppen anteckning', content: 'Synlig text', type: 'note', parentId: null, locked: 'false', tags: [], createdAt: now, updatedAt: now },
];
const apiNotes = notes.map((note) => ({
  ...note,
  title: encrypt(note.title),
  content: encrypt(note.content),
  type: encrypt(note.type),
  locked: encrypt(note.locked),
  tags: (note.tags || []).map((tag) => encrypt(tag)),
  createdAt: encrypt(note.createdAt),
  updatedAt: encrypt(note.updatedAt),
}));

const assertVisible = async (page, selector, timeout = 10000) => {
  await page.locator(selector).waitFor({ state: 'visible', timeout });
};

const assertHidden = async (page, selector, timeout = 10000) => {
  await page.waitForFunction((testSelector) => !document.querySelector(testSelector), selector, { timeout });
};

const run = async () => {
  const tempUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'noter-lock-flow-'));
  let notesRequests = 0;
  let tasksRequests = 0;
  let verifyRequests = 0;
  let lastVerifyPassword = null;
  const app = await electron.launch({
    args: [path.join(electronRoot, 'main.js')],
    env: {
      ...process.env,
      NODE_ENV: 'development',
      ELECTRON_RENDERER_URL: rendererUrl,
      ELECTRON_USER_DATA_DIR: tempUserData,
    },
  });

  try {
    const page = await app.firstWindow();

    await page.route('**/api/**', async (route, request) => {
      const url = new URL(request.url());
      if (url.pathname.endsWith('/api/notes') && request.method() === 'GET') {
        notesRequests += 1;
        if (notesRequests === 1) {
          await new Promise((resolve) => setTimeout(resolve, 9000));
        }
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(apiNotes) });
        return;
      }
      if (url.pathname.endsWith('/api/tasks') && request.method() === 'GET') {
        tasksRequests += 1;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
        return;
      }
      const verifyMatch = url.pathname.match(/\/api\/notes\/([^/]+)\/verify-lock$/);
      if (verifyMatch && request.method() === 'POST') {
        verifyRequests += 1;
        const noteId = verifyMatch[1];
        const body = JSON.parse(request.postData() || '{}');
        lastVerifyPassword = body.password ?? null;
        if (body.password !== 'secret') {
          await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: false, message: 'Invalid password' }) });
          return;
        }
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            content: noteId === 'n2' ? 'Hemlig rottext' : '',
            title: noteId === 'n2' ? 'Rothemlighet' : 'Projekt Låst',
            unlockedId: noteId === 'p1' ? 'p1' : 'n2',
          }),
        });
        return;
      }
      await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'not-found' }) });
    });

    await page.waitForTimeout(1500);
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
    await page.waitForTimeout(2500);

    const hasHook = await page.evaluate(() => Boolean(window.__NOTER_E2E__));
    if (hasHook) {
      await page.evaluate(async () => {
        await window.__NOTER_E2E__.hydrate();
        await window.__NOTER_E2E__.fetchNotes();
      });
    }

    await assertVisible(page, '[data-testid="sidebar-note-n3"]');
    await assertHidden(page, '[data-testid="sidebar-note-n1"]');
    await assertHidden(page, '[data-testid="sidebar-note-n4"]');

    await page.selectOption('#project-select', 'p1');
    await assertVisible(page, '[data-testid="password-modal"]');
    await page.getByTestId('password-input').focus();
    await page.getByTestId('password-input').fill('secret');
    await page.getByTestId('password-submit').click();

    try {
      await assertVisible(page, '[data-testid="sidebar-note-n1"]');
    } catch (error) {
      const debugState = hasHook
        ? await page.evaluate(() => {
            const state = window.__NOTER_E2E__.getState();
            return {
              activeProjectId: state.activeProjectId,
              selectedNoteId: state.selectedNoteId,
              unlockedProtectedNoteIds: state.unlockedProtectedNoteIds,
              noteIds: state.notes.map((note) => note._id),
              visibleBody: document.body.innerText.slice(0, 1200),
            };
          })
        : { hasHook: false, visibleBody: await page.locator('body').innerText() };
      debugState.notesRequests = notesRequests;
      debugState.tasksRequests = tasksRequests;
      debugState.verifyRequests = verifyRequests;
      debugState.lastVerifyPassword = lastVerifyPassword;
      console.error(JSON.stringify(debugState, null, 2));
      throw error;
    }
    await assertVisible(page, '[data-testid="sidebar-note-sp1"]');
    await page.locator('[data-testid="sidebar-note-n1"]').click();
    await page.getByText('Projekthemlighet').waitFor({ state: 'visible', timeout: 10000 });

    await page.selectOption('#project-select', '');
    await assertHidden(page, '[data-testid="sidebar-note-n1"]');
    await assertHidden(page, '[data-testid="sidebar-note-n4"]');

    await page.locator('[data-testid="sidebar-note-n2"]').click();
    await assertVisible(page, '[data-testid="password-modal"]');
    await page.getByTestId('password-input').focus();
    await page.getByTestId('password-input').fill('secret');
    await page.getByTestId('password-submit').click();

    await page.getByText('Hemlig rottext').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('[data-testid="sidebar-note-n3"]').click();
    await page.locator('[data-testid="sidebar-note-n2"]').click();
    await assertVisible(page, '[data-testid="password-modal"]');
  } finally {
    await app.close();
  }
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
