const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  getSettings: () => ipcRenderer.invoke("get-settings"),
  setSettings: (next) => ipcRenderer.invoke("set-settings", next),
  getState: () => ipcRenderer.invoke("get-state"),
  getHistory: () => ipcRenderer.invoke("get-history"),
  getNotificationsState: () => ipcRenderer.invoke("get-notifications-state"),
  markNotificationsRead: (ts) => ipcRenderer.invoke("mark-notifications-read", ts),
  clearHistory: () => ipcRenderer.invoke("clear-history"),
  exportHistoryCSV: () => ipcRenderer.invoke("export-history-csv"),
  runCheck: () => ipcRenderer.invoke("run-check"),
  openOverlay: (username) => ipcRenderer.invoke("open-overlay", username),
  openChatPopup: (username) => ipcRenderer.invoke("open-chat-popup", username),
  openHistoryPopup: () => ipcRenderer.invoke("open-history-popup"),
  openSettingsPopup: () => ipcRenderer.invoke("open-settings-popup"),
  openJoinTrackerPopup: (hostUsername) => ipcRenderer.invoke("open-join-tracker-popup", hostUsername),
  openDetailsPopup: (username) => ipcRenderer.invoke("open-details-popup", username),
  getJoinTrackerState: () => ipcRenderer.invoke("get-join-tracker-state"),
  setWatchUsers: (watchUsers) => ipcRenderer.invoke("set-watch-users", watchUsers),
  clearJoinEvents: () => ipcRenderer.invoke("clear-join-events"),
  exportJoinEventsCSV: () => ipcRenderer.invoke("export-join-events-csv"),
  startJoinTracking: (hostUsername) => ipcRenderer.invoke("start-join-tracking", hostUsername),
  startJoinTrackingAllLive: () => ipcRenderer.invoke("start-join-tracking-all-live"),
  stopJoinTracking: () => ipcRenderer.invoke("stop-join-tracking"),
  chooseSoundFile: () => ipcRenderer.invoke("choose-sound-file"),
  testSound: (payload) => ipcRenderer.invoke("test-sound", payload),
  reloadUI: () => ipcRenderer.invoke("reload-ui"),
  toggleDevTools: () => ipcRenderer.invoke("toggle-devtools"),
  restartApp: (opts) => ipcRenderer.invoke("restart-app", opts),
  clearCache: () => ipcRenderer.invoke("clear-cache"),
  factoryReset: () => ipcRenderer.invoke("factory-reset"),
  exportConfigJSON: () => ipcRenderer.invoke("export-config-json"),
  importConfigJSON: (opts) => ipcRenderer.invoke("import-config-json", opts),
  onStateUpdated: (handler) => {
    ipcRenderer.on("state-updated", (_e, state) => handler(state));
    return () => ipcRenderer.removeAllListeners("state-updated");
  },
  onSettingsUpdated: (handler) => {
    ipcRenderer.on("settings-updated", (_e, settings) => handler(settings));
    return () => ipcRenderer.removeAllListeners("settings-updated");
  }
  ,
  onHistoryUpdated: (handler) => {
    ipcRenderer.on("history-updated", (_e, h) => handler(h));
    return () => ipcRenderer.removeAllListeners("history-updated");
  }
  ,
  onNotificationsStateUpdated: (handler) => {
    ipcRenderer.on("notifications-state-updated", (_e, s) => handler(s));
    return () => ipcRenderer.removeAllListeners("notifications-state-updated");
  }
  ,
  onJoinTrackerUpdated: (handler) => {
    ipcRenderer.on("join-tracker-updated", (_e, payload) => handler(payload));
    return () => ipcRenderer.removeAllListeners("join-tracker-updated");
  }
  ,
  getAppStatus: () => ipcRenderer.invoke("get-app-status"),
  onAppStatusUpdated: (handler) => {
    ipcRenderer.on("app-status-updated", (_e, payload) => handler(payload));
    return () => ipcRenderer.removeAllListeners("app-status-updated");
  }
});

