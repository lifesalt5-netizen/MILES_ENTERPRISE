const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('miles', {
  start: () => ipcRenderer.invoke('runtime:start'),
  stop: () => ipcRenderer.invoke('runtime:stop'),
  restart: () => ipcRenderer.invoke('runtime:restart'),
  status: () => ipcRenderer.invoke('runtime:status'),
  command: (message) => ipcRenderer.invoke('executive:command', message),
  decideApproval: (id, decision) => ipcRenderer.invoke('approval:decide', id, decision)
});
