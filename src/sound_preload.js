const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("soundApi", {
  onPlay: (handler) => {
    ipcRenderer.on("play-sound", (_e, payload) => handler(payload));
    return () => ipcRenderer.removeAllListeners("play-sound");
  }
});

