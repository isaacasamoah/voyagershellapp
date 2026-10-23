const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld(
  'voyager',
  Object.freeze({
    conversationReady: () => ipcRenderer.invoke('conversation-ready'),
    selectAppVoice: () => ipcRenderer.invoke('voice-app'),
    nativeVoice: (id, active) => ipcRenderer.invoke('voice-native', id, active),
    chat: (text, request) => ipcRenderer.invoke('conversation-send', text, request),
    startVoice: (sdp) => ipcRenderer.invoke('conversation-voice-start', sdp),
    stopVoice: () => ipcRenderer.invoke('conversation-voice-stop'),
    voiceActivity: (speaker, active) =>
      ipcRenderer.invoke('conversation-voice-activity', speaker, active),
    onConversation: (callback) => {
      const listener = (_event, value) => callback(value);
      ipcRenderer.on('conversation', listener);
      return () => ipcRenderer.removeListener('conversation', listener);
    },
    toggle: () => ipcRenderer.invoke('toggle'),
    beginPanelDrag: (x, y) => ipcRenderer.invoke('begin-panel-drag', x, y),
    endPanelDrag: () => ipcRenderer.invoke('end-panel-drag'),
    beginDrag: (x, y) => ipcRenderer.invoke('begin-drag', x, y),
    endDrag: () => ipcRenderer.invoke('end-drag'),
    cancelDrag: () => ipcRenderer.invoke('cancel-drag'),
    chooseDirectory: () => ipcRenderer.invoke('choose-directory'),
    createInstance: (input) => ipcRenderer.invoke('create-instance', input),
    surfaceInstance: (id) => ipcRenderer.invoke('surface-instance', id),
    createFleet: (name, request) => ipcRenderer.invoke('create-fleet', name, request),
    moveVessel: (id, fleet) => ipcRenderer.invoke('move-vessel', id, fleet),
    removeFleet: (id) => ipcRenderer.invoke('remove-fleet', id),
    renameFleet: (id, name) => ipcRenderer.invoke('rename-fleet', id, name),
    renameInstance: (id, name, request) => ipcRenderer.invoke('rename-instance', id, name, request),
    surfaceFleet: (id) => ipcRenderer.invoke('surface-fleet', id),
    panelContentHeight: (height) => ipcRenderer.invoke('panel-content-height', height),
    backgroundInstance: (id, request) => ipcRenderer.invoke('background-instance', id, request),
    stopInstance: (id, request) => ipcRenderer.invoke('stop-instance', id, request),
    removeInstance: (id, request, stop) => ipcRenderer.invoke('remove-instance', id, request, stop),
    registerInstance: (id, request) => ipcRenderer.invoke('register-instance', id, request),
    rankInstance: (id, rank, request) => ipcRenderer.invoke('rank-instance', id, rank, request),
    superviseInstance: (id, supervisor, request) =>
      ipcRenderer.invoke('supervise-instance', id, supervisor, request),
    quit: () => ipcRenderer.invoke('quit-ui'),
    stopService: () => ipcRenderer.invoke('stop-service'),
    onDockSound: (callback) => {
      ipcRenderer.on('dock-sound', (_event, action) => callback(action));
    },
    onState: (callback) => {
      ipcRenderer.on('state', (_event, value) => callback(value));
    },
    ready: () => ipcRenderer.invoke('ready'),
  }),
);
