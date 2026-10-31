const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("voyager", {
  call: (method, input) => ipcRenderer.invoke("voyager", method, input),
  on: (topic, receive) => {
    if (
      ![
        "workspace",
        "terminal",
        "connection",
        "conversation",
        "native-window",
        "avatar-state",
        "voice-toggle",
        "voice-reset",
      ].includes(topic)
    )
      throw Error("Unknown Voyager event.");
    const listener = (_, value) => receive(value);
    ipcRenderer.on(topic, listener);
    return () => ipcRenderer.removeListener(topic, listener);
  },
});
