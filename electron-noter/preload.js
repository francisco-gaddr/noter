const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('mlc', {
  isElectron: true,
  getModels: () => ipcRenderer.invoke('mlc:get-models'),
  searchModels: (payload) => ipcRenderer.invoke('mlc:search-models', payload),
  getModelFiles: (payload) => ipcRenderer.invoke('mlc:get-model-files', payload),
  downloadAndConvert: (payload) => ipcRenderer.invoke('mlc:download', payload),
  deleteModel: (payload) => ipcRenderer.invoke('mlc:delete', payload),
  chat: (payload) => ipcRenderer.invoke('mlc:chat', payload),
  cancelChat: (payload) => ipcRenderer.invoke('mlc:cancel-chat', payload),
  onDownloadProgress: (handler) => {
    const listener = (_event, data) => handler(data);
    ipcRenderer.on('mlc:download-progress', listener);
    return () => ipcRenderer.removeListener('mlc:download-progress', listener);
  },
  onChatToken: (handler) => {
    const listener = (_event, data) => handler(data);
    ipcRenderer.on('mlc:chat-token', listener);
    return () => ipcRenderer.removeListener('mlc:chat-token', listener);
  },
  getPerformanceSnapshot: () => ipcRenderer.invoke('perf:get-snapshot'),
  resetPerformanceSnapshot: () => ipcRenderer.invoke('perf:reset-snapshot'),
  getSetting: (key) => ipcRenderer.invoke('settings:get', key),
  getManySettings: (keys) => ipcRenderer.invoke('settings:get-many', keys),
  setSetting: (key, value) => ipcRenderer.invoke('settings:set', { key, value }),
  setManySettings: (values) => ipcRenderer.invoke('settings:set-many', values),
  setLockState: (locked) => ipcRenderer.invoke('settings:set', { key: 'appLocked', value: Boolean(locked) })
});
