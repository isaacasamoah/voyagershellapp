const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('voyager', {
  ready: () => ipcRenderer.invoke('voyager-ready'),
  chat: (text) => ipcRenderer.invoke('voyager-chat', text),
  startVoice: (sdp) => ipcRenderer.invoke('voyager-voice-start', sdp),
  stopVoice: () => ipcRenderer.invoke('voyager-voice-stop'),
  observe: (value) => ipcRenderer.invoke('voyager-observe', value),
  onEvent: (callback) => {
    const listener = (_, value) => callback(value);
    ipcRenderer.on('voyager-event', listener);
    return () => ipcRenderer.removeListener('voyager-event', listener);
  },
});
