const path = require('path');
const os = require('os');
const fs = require('fs');
const CryptoJS = require('crypto-js');
const { _electron: electron } = require('playwright');

const rendererUrl = process.env.E2E_RENDERER_URL || 'http://localhost:3001/';
const apiBaseUrl = `${new URL(rendererUrl).origin}/api`;
const electronRoot = path.join(__dirname, '..', '..');

const encrypt = (value) => CryptoJS.AES.encrypt(String(value ?? ''), 'noter-default-key').toString();
const decrypt = (value) => CryptoJS.AES.decrypt(String(value ?? ''), 'noter-default-key').toString(CryptoJS.enc.Utf8);
const nowIso = () => new Date().toISOString();

const toApiNote = (note) => ({
  ...note,
  title: encrypt(note.title),
  content: encrypt(note.content || ''),
  type: encrypt(note.type || 'note'),
  locked: encrypt(String(Boolean(note.locked))),
  tags: (note.tags || []).map((tag) => encrypt(tag)),
  createdAt: encrypt(note.createdAt),
  updatedAt: encrypt(note.updatedAt),
});

const toApiTask = (task) => ({
  ...task,
  title: encrypt(task.title),
  description: encrypt(task.description || ''),
  completed: encrypt(String(Boolean(task.completed))),
  priority: encrypt(task.priority || 'medium'),
  createdAt: encrypt(task.createdAt),
  updatedAt: encrypt(task.updatedAt),
});

const run = async () => {
  const tempUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'noter-crud-flow-'));
  const notes = [];
  const tasks = [];
  let noteCounter = 1;
  let taskCounter = 1;

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
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(notes.map(toApiNote)) });
        return;
      }
      if (url.pathname.endsWith('/api/tasks') && request.method() === 'GET') {
        const parentNoteId = url.searchParams.get('parentNoteId');
        const filtered = parentNoteId ? tasks.filter((task) => task.parentNoteId === parentNoteId) : tasks;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(filtered.map(toApiTask)) });
        return;
      }
      if (url.pathname.endsWith('/api/notes') && request.method() === 'POST') {
        const body = JSON.parse(request.postData() || '{}');
        const note = {
          _id: `note-${noteCounter++}`,
          title: decrypt(body.title),
          content: decrypt(body.content),
          type: decrypt(body.type),
          locked: decrypt(body.locked) === 'true',
          parentId: body.parentId || null,
          tags: (body.tags || []).map((tag) => decrypt(tag)),
          createdAt: decrypt(body.createdAt) || nowIso(),
          updatedAt: decrypt(body.updatedAt) || nowIso(),
        };
        notes.push(note);
        await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(toApiNote(note)) });
        return;
      }
      const noteMatch = url.pathname.match(/\/api\/notes\/([^/]+)$/);
      if (noteMatch && request.method() === 'PUT') {
        const body = JSON.parse(request.postData() || '{}');
        const note = notes.find((item) => item._id === noteMatch[1]);
        if (!note) {
          await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'not-found' }) });
          return;
        }
        note.title = body.title ? decrypt(body.title) : note.title;
        note.content = body.content ? decrypt(body.content) : note.content;
        note.updatedAt = body.updatedAt ? decrypt(body.updatedAt) : nowIso();
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(toApiNote(note)) });
        return;
      }
      if (url.pathname.endsWith('/api/tasks') && request.method() === 'POST') {
        const body = JSON.parse(request.postData() || '{}');
        const task = {
          _id: `task-${taskCounter++}`,
          title: decrypt(body.title),
          description: body.description ? decrypt(body.description) : '',
          completed: body.completed ? decrypt(body.completed) === 'true' : false,
          priority: body.priority ? decrypt(body.priority) : 'medium',
          parentNoteId: body.parentNoteId || null,
          createdAt: body.createdAt ? decrypt(body.createdAt) : nowIso(),
          updatedAt: body.updatedAt ? decrypt(body.updatedAt) : nowIso(),
        };
        tasks.push(task);
        await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(toApiTask(task)) });
        return;
      }
      const taskMatch = url.pathname.match(/\/api\/tasks\/([^/]+)$/);
      if (taskMatch && request.method() === 'PUT') {
        const body = JSON.parse(request.postData() || '{}');
        const task = tasks.find((item) => item._id === taskMatch[1]);
        if (!task) {
          await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'not-found' }) });
          return;
        }
        task.title = body.title ? decrypt(body.title) : task.title;
        task.description = body.description ? decrypt(body.description) : task.description;
        task.updatedAt = body.updatedAt ? decrypt(body.updatedAt) : nowIso();
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(toApiTask(task)) });
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
    await page.waitForTimeout(2000);

    const result = await page.evaluate(async () => {
      const hook = window.__NOTER_E2E__;
      await hook.hydrate();
      await hook.fetchNotes();
      const project = await hook.createNote('Projekt Alpha', '', null, 'project');
      await hook.setActiveProject(project._id);
      const list = await hook.createNote('Lista Alpha', '', project._id, 'task_list');
      const note = await hook.createNote('Anteckning Alpha', 'Originaltext', project._id, 'note');
      const task = await hook.createTask('Uppgift Alpha', list._id);
      await hook.updateNote(note._id, { title: 'Anteckning Alpha Uppdaterad', content: 'Ny text' });
      await hook.updateTask(task._id, { title: 'Uppgift Alpha Uppdaterad', description: 'Ny beskrivning' });
      await hook.fetchNotes();
      await hook.fetchTasks(list._id);
      const state = hook.getState();
      return {
        noteTitles: state.notes.map((item) => item.title),
        taskTitles: state.tasks.map((item) => item.title),
        activeProjectId: state.activeProjectId,
        selectedTaskListId: state.selectedTaskListId,
      };
    });

    if (!result.noteTitles.includes('Projekt Alpha')) throw new Error('Project was not created');
    if (!result.noteTitles.includes('Lista Alpha')) throw new Error('Task list was not created');
    if (!result.noteTitles.includes('Anteckning Alpha Uppdaterad')) throw new Error('Note update did not persist');
    if (!result.taskTitles.includes('Uppgift Alpha Uppdaterad')) throw new Error('Task update did not persist');
    if (!result.activeProjectId) throw new Error('Active project was not selected');
  } finally {
    await app.close();
  }
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
