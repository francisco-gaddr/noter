// Tests for the injected preload bridge (window.mlc / window.noterDesktop). Uses only node:test —
// no extra deps. The bridge is a browser IIFE that reads `window` / `fetch` as globals, so we load it
// with `new Function('window','fetch', src)` and a mocked Tauri surface, then assert the JS behaviour.
// Rust-side logic (secure store, deep-link parser) is covered by `cargo test`; this covers the seam.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const bridgeSrc = fs.readFileSync(
  path.join(here, '..', 'src-tauri', 'bridge', 'preload-bridge.js'),
  'utf8'
);

// Load the bridge with a mocked Tauri surface; returns the populated `window`.
function loadBridge(tauri = {}, { fetch, print } = {}) {
  const T = {
    core: { invoke: async () => {} },
    event: { listen: async () => () => {} },
    ...tauri,
  };
  const win = { __TAURI__: T, print: print || (() => {}) };
  // eslint-disable-next-line no-new-func
  new Function('window', 'fetch', bridgeSrc)(win, fetch);
  return win;
}

test('flags: bridge presents itself as a native desktop bridge', () => {
  const win = loadBridge();
  assert.equal(win.mlc.isElectron, true);
  assert.equal(win.mlc.isTauri, true);
  assert.equal(win.noterDesktop.isTauri, true);
});

test('mlc.getModels returns [] until the subprocess phase lands', async () => {
  const win = loadBridge();
  assert.deepEqual(await win.mlc.getModels(), []);
});

test('mlc.searchModels maps HuggingFace results to the app shape', async () => {
  const fetchMock = async () => ({
    ok: true,
    json: async () => [{ id: 'TheBloke/foo-GGUF', downloads: 5, likes: 2, tags: ['gguf'] }],
  });
  const win = loadBridge({}, { fetch: fetchMock });
  const r = await win.mlc.searchModels('foo');
  assert.equal(r[0].id, 'TheBloke/foo-GGUF');
  assert.equal(r[0].name, 'foo-GGUF');
  assert.equal(r[0].author, 'TheBloke');
  assert.equal(r[0].downloads, 5);
});

test('showOpenDialog adapts a single path to Electron shape', async () => {
  const win = loadBridge({ dialog: { open: async () => '/x/a.md' } });
  assert.deepEqual(await win.noterDesktop.showOpenDialog({}), {
    canceled: false,
    filePaths: ['/x/a.md'],
  });
});

test('showOpenDialog adapts a cancel (null) to canceled:true', async () => {
  const win = loadBridge({ dialog: { open: async () => null } });
  assert.deepEqual(await win.noterDesktop.showOpenDialog({}), { canceled: true, filePaths: [] });
});

test('showOpenDialog maps Electron properties to Tauri opts', async () => {
  let received = null;
  const win = loadBridge({ dialog: { open: async (o) => { received = o; return ['a', 'b']; } } });
  const res = await win.noterDesktop.showOpenDialog({ properties: ['multiSelections', 'openDirectory'] });
  assert.equal(received.multiple, true);
  assert.equal(received.directory, true);
  assert.deepEqual(res, { canceled: false, filePaths: ['a', 'b'] });
});

test('LOCK INVARIANT: printNote never prints a locked note', async () => {
  let printed = false;
  const win = loadBridge({}, { print: () => { printed = true; } });
  const res = await win.noterDesktop.printNote({}, true);
  assert.deepEqual(res, { ok: false, reason: 'note-is-locked' });
  assert.equal(printed, false, 'window.print MUST NOT be called for a locked note');
});

test('printNote prints an unlocked note', async () => {
  let printed = false;
  const win = loadBridge({}, { print: () => { printed = true; } });
  const res = await win.noterDesktop.printNote({}, false);
  assert.equal(res.ok, true);
  assert.equal(printed, true);
});

test('notify requests permission then sends', async () => {
  let sent = null;
  const win = loadBridge({
    notification: {
      isPermissionGranted: async () => false,
      requestPermission: async () => 'granted',
      sendNotification: (p) => { sent = p; },
    },
  });
  await win.noterDesktop.notify({ title: 'T', body: 'B' });
  assert.deepEqual(sent, { title: 'T', body: 'B' });
});

test('notify does not send when permission is denied', async () => {
  let sent = false;
  const win = loadBridge({
    notification: {
      isPermissionGranted: async () => false,
      requestPermission: async () => 'denied',
      sendNotification: () => { sent = true; },
    },
  });
  await win.noterDesktop.notify({ title: 'T' });
  assert.equal(sent, false);
});

test('secureSet invokes secure_set with key+value', async () => {
  let call = null;
  const win = loadBridge({ core: { invoke: async (cmd, args) => { call = { cmd, args }; } } });
  await win.noterDesktop.secureSet('token', 'abc');
  assert.deepEqual(call, { cmd: 'secure_set', args: { key: 'token', value: 'abc' } });
});

test('settings getSetting/setSetting route to the settings commands', async () => {
  const calls = [];
  const win = loadBridge({ core: { invoke: async (cmd, args) => { calls.push([cmd, args]); return 'v'; } } });
  await win.mlc.getSetting('k');
  await win.mlc.setSetting('k', 1);
  assert.deepEqual(calls[0], ['settings_get', { key: 'k' }]);
  assert.deepEqual(calls[1], ['settings_set', { key: 'k', value: 1 }]);
});

test('onNoteOpenRequested subscribes to the note:open event', async () => {
  let subscribed = null;
  const win = loadBridge({ event: { listen: async (evt) => { subscribed = evt; return () => {}; } } });
  win.noterDesktop.onNoteOpenRequested(() => {});
  // listen is async; give the microtask a tick
  await Promise.resolve();
  assert.equal(subscribed, 'note:open');
});

test('unported channels reject with a clear message', async () => {
  const win = loadBridge();
  await assert.rejects(() => win.mlc.chat({}), /being ported/);
  await assert.rejects(() => win.noterDesktop.printNoteToPdf({}), /being ported/);
});
