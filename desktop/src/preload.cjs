const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld(
  'voyager',
  Object.freeze({
    drawingReport: (state) => ipcRenderer.send('whiteboard-report', state),
    onDrawingCommand: (callback) =>
      ipcRenderer.on('whiteboard-command', (_event, command) => callback(command)),
    whiteboard: (command) => ipcRenderer.invoke('whiteboard', command),
    expandWhiteboard: (value) => ipcRenderer.invoke('whiteboard-expand', value),
    toggle: () => ipcRenderer.invoke('toggle'),
    beginDrag: (x, y) => ipcRenderer.invoke('begin-drag', x, y),
    endDrag: () => ipcRenderer.invoke('end-drag'),
    cancelDrag: () => ipcRenderer.invoke('cancel-drag'),
    select: (id) => ipcRenderer.invoke('select', id),
    createForm: (open) => ipcRenderer.invoke('create-form', open),
    chooseDirectory: () => ipcRenderer.invoke('choose-directory'),
    createInstance: (input) => ipcRenderer.invoke('create-instance', input),
    openInstance: (id) => ipcRenderer.invoke('open-instance', id),
    backgroundInstance: (id, request) => ipcRenderer.invoke('background-instance', id, request),
    stopInstance: (id, request) => ipcRenderer.invoke('stop-instance', id, request),
    removeInstance: (id, request, stop) => ipcRenderer.invoke('remove-instance', id, request, stop),
    registerInstance: (id, request) => ipcRenderer.invoke('register-instance', id, request),
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
