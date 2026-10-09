const { app, BrowserWindow } = require('electron');
const path = require('node:path');
// A separate client experiment: never starts, owns or stops an agent process.
app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 1320,
    height: 900,
    backgroundColor: '#f6f4ee',
    title: 'Voyager · whiteboard experiment',
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.loadFile(path.join(__dirname, 'index.html'));
});
app.on('window-all-closed', () => app.quit());
