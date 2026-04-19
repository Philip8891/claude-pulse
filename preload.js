const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  platform: process.platform,
  hideWindow: () => ipcRenderer.send("hide-window"),
  resizeTo: (dim) => ipcRenderer.send("resize-to", dim),
  startAutoLogin: (opts) => ipcRenderer.send("start-auto-login", opts || {}),
  onLoginStatus: (callback) => {
    ipcRenderer.on("login-status", (event, status) => callback(status));
  },
  // Autostart
  getAutostart: () => ipcRenderer.invoke("get-autostart"),
  setAutostart: (enabled) => ipcRenderer.invoke("set-autostart", enabled),
});
