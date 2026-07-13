const path = require('path');
const { app, BrowserWindow, ipcMain, Tray, Menu } = require('electron');
const { MilesRuntime } = require('./runtime/milesRuntime');

let win;
let tray;
let runtime;

function createWindow() {
  win = new BrowserWindow({ width: 1400, height: 900, title: 'MILES Desktop v2', webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false } });
  win.loadFile(path.join(__dirname, '../renderer/index.html'));
}
function setupIpc() {
  ipcMain.handle('runtime:start', () => runtime.start());
  ipcMain.handle('runtime:stop', () => runtime.stop());
  ipcMain.handle('runtime:restart', () => runtime.restart());
  ipcMain.handle('runtime:status', () => runtime.status());
  ipcMain.handle('executive:command', (_e, message) => runtime.command(message));
  ipcMain.handle('approval:decide', (_e, id, decision) => runtime.approvals.decide(id, decision));
}
app.whenReady().then(() => {
  runtime = new MilesRuntime(path.resolve(__dirname, '../../'));
  setupIpc(); createWindow(); runtime.start();
  try {
    const fs = require('fs');
    const iconPath = process.platform === 'win32' ? path.join(__dirname, '../renderer/favicon.ico') : path.join(__dirname, '../renderer/favicon.png');
    if (fs.existsSync(iconPath)) {
      tray = new Tray(iconPath);
      tray.setContextMenu(Menu.buildFromTemplate([{ label:'Open MILES', click:()=>win.show() }, { label:'Restart Runtime', click:()=>runtime.restart() }, { label:'Quit', click:()=>app.quit() }]));
    }
  } catch (_err) { tray = null; }
});
app.on('window-all-closed', e => { if (process.platform !== 'darwin') app.quit(); });
