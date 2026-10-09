const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld(
  'voyager',
  Object.freeze({
    toggle: () => ipcRenderer.invoke('toggle'),
    beginDrag: (x, y) => ipcRenderer.invoke('begin-drag', x, y),
    endDrag: () => ipcRenderer.invoke('end-drag'),
    cancelDrag: () => ipcRenderer.invoke('cancel-drag'),
    undock: () => ipcRenderer.invoke('undock'),
    select: (id) => ipcRenderer.invoke('select', id),
    quit: () => ipcRenderer.invoke('quit-ui'),
    onDockSound: (callback) => {
      ipcRenderer.on('dock-sound', (_event, action) => callback(action));
    },
    onState: (callback) => {
      ipcRenderer.on('state', (_event, value) => callback(value));
    },
    ready: () => ipcRenderer.invoke('ready'),
  }),
);
