const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('miles', {
  getState: () => ipcRenderer.invoke('state:get'),
  startRuntime: () => ipcRenderer.invoke('runtime:start'),
  stopRuntime: () => ipcRenderer.invoke('runtime:stop'),
  restartRuntime: () => ipcRenderer.invoke('runtime:restart'),
  healthCheck: () => ipcRenderer.invoke('runtime:health'),
  executeCommand: (text) => ipcRenderer.invoke('command:execute', text)
});
