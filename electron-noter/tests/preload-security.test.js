const fs = require('fs');
const path = require('path');

const preloadJs = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');

describe('electron preload security contract', () => {
  it('exposes only invoke-based bridge methods', () => {
    expect(preloadJs).toContain("contextBridge.exposeInMainWorld('mlc'");
    expect(preloadJs).toContain("ipcRenderer.invoke('mlc:get-models')");
    expect(preloadJs).toContain("ipcRenderer.invoke('perf:get-snapshot')");
    expect(preloadJs).toContain("ipcRenderer.invoke('perf:reset-snapshot')");
    expect(preloadJs).toContain("ipcRenderer.invoke('settings:get-many', keys)");
    expect(preloadJs).toContain("ipcRenderer.invoke('settings:set', { key, value })");
    expect(preloadJs).toContain("ipcRenderer.invoke('settings:set-many', values)");
    expect(preloadJs).not.toContain('ipcRenderer.sendSync');
    expect(preloadJs).not.toContain('ipcRenderer.send(');
    expect(preloadJs).not.toContain('exposeInMainWorld(\'electron\'');
  });

  it('keeps removable event subscriptions for streamed ai updates', () => {
    expect(preloadJs).toContain("ipcRenderer.on('mlc:download-progress'");
    expect(preloadJs).toContain("ipcRenderer.removeListener('mlc:download-progress'");
    expect(preloadJs).toContain("ipcRenderer.on('mlc:chat-token'");
    expect(preloadJs).toContain("ipcRenderer.removeListener('mlc:chat-token'");
  });
});
