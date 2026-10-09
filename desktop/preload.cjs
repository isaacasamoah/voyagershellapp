const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld(
  'voyager',
  Object.freeze({
    toggle: () => ipcRenderer.invoke('toggle'),
    beginDrag: (x, y) => ipcRenderer.invoke('begin-drag', x, y),
    endDrag: () => ipcRenderer.invoke('end-drag'),
    cancelDrag: () => ipcRenderer.invoke('cancel-drag'),
    undock: () => ipcRenderer.invoke('undock'),
    openTerminal: (id) => ipcRenderer.invoke('open-terminal', id),
    select: (id) => ipcRenderer.invoke('select', id),
    dock: (id) => ipcRenderer.invoke('dock', id),
    quit: () => ipcRenderer.invoke('quit-ui'),
    onState: (callback) => {
      ipcRenderer.on('state', (_event, value) => callback(value));
    },
    ready: () => ipcRenderer.invoke('ready'),
  }),
);
