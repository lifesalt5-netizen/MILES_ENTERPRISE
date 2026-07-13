const { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const RuntimeHost = require('../runtime/runtimeHost');
const { snapshot, state } = require('../shared/state');

const rootDir = path.join(__dirname, '..', '..');
const logDir = path.join(rootDir, 'logs');
const configPath = path.join(rootDir, 'config', 'miles.config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

function logger(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  fs.appendFileSync(path.join(logDir, 'miles-desktop.log'), line);
}

let mainWindow;
let tray;
const runtimeHost = new RuntimeHost(logger, config);

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    title: 'MILES Desktop v2',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

function setupTray() {
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip('MILES Desktop v2');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open MILES', click: () => mainWindow.show() },
    { label: 'Start Runtime', click: () => runtimeHost.start() },
    { label: 'Stop Runtime', click: () => runtimeHost.stop() },
    { label: 'Quit', click: () => app.quit() }
  ]));
}

app.whenReady().then(() => {
  createWindow();
  setupTray();
  app.setLoginItemSettings({ openAtLogin: true, name: 'MILES Desktop v2' });
  if (config.runtime.autoStart) runtimeHost.start();
});

ipcMain.handle('state:get', () => snapshot());
ipcMain.handle('runtime:start', () => runtimeHost.start());
ipcMain.handle('runtime:stop', () => runtimeHost.stop());
ipcMain.handle('runtime:restart', () => runtimeHost.restart());
ipcMain.handle('runtime:health', () => runtimeHost.healthCheck());
ipcMain.handle('command:execute', (_event, text) => runtimeHost.execute(text));
ipcMain.handle('approval:add', (_event, approval) => {
  state.approvals.unshift({ ...approval, id: `approval-${Date.now()}`, status: 'pending', createdAt: new Date().toISOString() });
  return snapshot();
});

app.on('window-all-closed', (event) => {
  event.preventDefault();
  if (mainWindow) mainWindow.hide();
});
