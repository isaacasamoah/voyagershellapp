const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld(
  'drawing',
  Object.freeze({
    report: (state) => ipcRenderer.send('whiteboard-report', state),
    hide: () => ipcRenderer.send('whiteboard-hide'),
    ready: () => ipcRenderer.send('whiteboard-ready'),
    onCommand: (callback) =>
      ipcRenderer.on('whiteboard-command', (_event, command) => callback(command)),
  }),
);
