const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld(
  'voyager',
  Object.freeze({
    toggle: () => ipcRenderer.invoke('toggle'),
    beginDrag: (x, y) => ipcRenderer.invoke('begin-drag', x, y),
    endDrag: () => ipcRenderer.invoke('end-drag'),
    cancelDrag: () => ipcRenderer.invoke('cancel-drag'),
    createForm: (open) => ipcRenderer.invoke('create-form', open),
    chooseDirectory: () => ipcRenderer.invoke('choose-directory'),
    createInstance: (input) => ipcRenderer.invoke('create-instance', input),
    surfaceInstance: (id) => ipcRenderer.invoke('surface-instance', id),
    showGroup: (id, layout) => ipcRenderer.invoke('show-group', id, layout),
    backgroundInstance: (id, request) => ipcRenderer.invoke('background-instance', id, request),
    stopInstance: (id, request) => ipcRenderer.invoke('stop-instance', id, request),
    removeInstance: (id, request, stop) => ipcRenderer.invoke('remove-instance', id, request, stop),
    registerInstance: (id, request) => ipcRenderer.invoke('register-instance', id, request),
    rankInstance: (id, rank, request) => ipcRenderer.invoke('rank-instance', id, rank, request),
    superviseInstance: (id, supervisor, request) =>
      ipcRenderer.invoke('supervise-instance', id, supervisor, request),
    adjudicateEscalation: (id, escalation, decision, message, request) =>
      ipcRenderer.invoke('adjudicate-escalation', id, escalation, decision, message, request),
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
