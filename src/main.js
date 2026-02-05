const { app, BrowserWindow, ipcMain, Notification, shell, Tray, Menu, nativeImage, session } = require("electron");
const path = require("path");
const os = require("os");
const fs = require("fs");
const { dialog } = require("electron");
const Store = require("electron-store").default;
const { io } = require("socket.io-client");

// --- Fix Windows "Unable to create cache: Access is denied" by using a dedicated writable app data dir ---
// Must be configured before `app.whenReady()`.
const appDataRoot =
  process.env.LOCALAPPDATA ||
  process.env.APPDATA ||
  path.join(os.homedir(), "AppData", "Local");
const appDataDir = path.join(appDataRoot, "TikTokLiveWatcher");
const userDataDir = path.join(appDataDir, "userData");
const cacheDir = path.join(appDataDir, "cache");
const mediaCacheDir = path.join(appDataDir, "media-cache");
const tempDir = path.join(appDataDir, "temp");
const CLEAR_CACHE_ON_START_FLAG = "--clear-cache-on-start";

function safeRmDir(p) {
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

// If we relaunched with a cache-clear flag, delete Chromium cache dirs before Electron starts using them.
if (process.argv.includes(CLEAR_CACHE_ON_START_FLAG)) {
  safeRmDir(cacheDir);
  safeRmDir(mediaCacheDir);
  safeRmDir(tempDir);
}

try {
  fs.mkdirSync(appDataDir, { recursive: true });
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.mkdirSync(mediaCacheDir, { recursive: true });
  fs.mkdirSync(tempDir, { recursive: true });
} catch {
  // ignore
}

try {
  app.setPath("userData", userDataDir);
  // Electron/Chromium also uses the "cache" path unless overridden.
  app.setPath("cache", cacheDir);
  app.setPath("temp", tempDir);
} catch {
  // ignore
}
app.commandLine.appendSwitch("disk-cache-dir", cacheDir);
app.commandLine.appendSwitch("media-cache-dir", mediaCacheDir);
app.commandLine.appendSwitch("disable-gpu-shader-disk-cache");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

const DEFAULTS = {
  usernames: ["kkstefanov", "ianaki82", "oceanclient1"],
  intervalMinutes: 1,
  perHostIntervals: {}, // { [username]: minutes }
  joinNotify: true,
  joinNotifyCooldownMinutes: 10,
  autoTrackAllLive: false,
  giftTrack: true,
  giftNotify: false,
  giftNotifyCooldownSeconds: 60,
  soundEnabled: true,
  soundType: "chime", // "beep" | "chime" | "alert" | "custom"
  soundCustomPath: "",
  themeMode: "system", // "system" | "dark" | "light"
  accent: "violet", // "violet" | "blue" | "teal" | "green" | "amber" | "red"
  density: "comfortable", // "comfortable" | "compact"
  dashboardView: "table", // "table" | "kanban"
  obsParams:
    "showLikes=1&showChats=1&showGifts=1&showFollows=1&showJoins=1&bgColor=rgb(24,23,28)&fontColor=rgb(227,229,235)&fontSize=1.3em"
};

const store = new Store({ defaults: DEFAULTS });

/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {Tray | null} */
let tray = null;
/** @type {Map<string, BrowserWindow>} */
const chatWindows = new Map();
/** @type {BrowserWindow | null} */
let historyWindow = null;
/** @type {BrowserWindow | null} */
let settingsWindow = null;
/** @type {BrowserWindow | null} */
let joinTrackerWindow = null;
/** @type {BrowserWindow | null} */
let soundWindow = null;

// Ensure single instance (prevents many electron.exe processes if started multiple times)
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

const HISTORY_LIMIT = 2000;
const HISTORY_KEY = "history";
const LAST_STATE_KEY = "lastState";
const WATCH_USERS_KEY = "watchUsers";
const JOIN_EVENTS_KEY = "joinEvents";
const JOIN_EVENTS_LIMIT = 5000;
const NOTIF_LAST_READ_AT_KEY = "notificationsLastReadAt";

let scheduleTimeout = null;
let nextScheduledCheckAt = 0;
let isChecking = false;
let rerunQueued = false;
let nextAllowedCheckAt = 0;

let lastState = store.get(LAST_STATE_KEY) || { byUser: {} };
let history = store.get(HISTORY_KEY) || [];
let watchUsers = store.get(WATCH_USERS_KEY) || [];
let joinEvents = store.get(JOIN_EVENTS_KEY) || [];

// Shared Zerody socket (prevents "too many connections" rate limits)
/** @type {import("socket.io-client").Socket | null} */
let zerodySocket = null;
let zerodyConnecting = null;

// Join tracker socket (kept separate from status-check socket)
/** @type {import("socket.io-client").Socket | null} */
let joinTrackerSocket = null;
let joinTrackerConnecting = null;
let joinTrackedHost = null; // host username we are currently tracking
let joinTrackerActive = false;
let joinCooldownUntil = 0;
let joinTrackingMode = "single"; // "single" | "allLive"
let joinRotationAbortId = 0;
let lastJoinSwitchAt = 0;

const RATE_LIMIT_COOLDOWN_MS = 5 * 60 * 1000;
const JOIN_SWITCH_MIN_INTERVAL_MS = 25 * 1000;
const JOIN_DWELL_MS = 60 * 1000;
const STATUS_MIN_INTERVAL_WHEN_ALLLIVE_MS = 5 * 60 * 1000;

let lastStatusCheckAt = 0;
const lastJoinNotifyAt = new Map(); // key: host|viewer -> ts
const lastGiftNotifyAt = new Map(); // key: host|viewer -> ts

function getNotificationsState() {
  const v = Number(store.get(NOTIF_LAST_READ_AT_KEY) || 0);
  return { lastReadAt: Number.isFinite(v) ? v : 0 };
}

function markNotificationsRead(ts) {
  const target = Number(ts || 0);
  const safe = Number.isFinite(target) && target > 0 ? target : Date.now();
  store.set(NOTIF_LAST_READ_AT_KEY, safe);
  broadcastNotificationsState();
  return { lastReadAt: safe };
}

function maybeNotifyViewerJoined({ host, viewer }) {
  const settings = getSettings();
  if (!settings.joinNotify) return;
  if (!host || !viewer) return;

  const cooldownMs = clampJoinNotifyCooldownMinutes(settings.joinNotifyCooldownMinutes) * 60 * 1000;
  const key = `${host}|${viewer}`;
  const prev = lastJoinNotifyAt.get(key) || 0;
  if (cooldownMs > 0 && Date.now() - prev < cooldownMs) return;
  lastJoinNotifyAt.set(key, Date.now());

  const n = new Notification({
    title: `@${viewer} влезе при @${host}`,
    body: "Натисни за отваряне на чата."
  });
  n.on("click", () => openChatPopup(host));
  playSound();
  n.show();
}

function clampGiftNotifyCooldownSeconds(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return DEFAULTS.giftNotifyCooldownSeconds;
  return Math.max(0, Math.min(3600, Math.round(num)));
}

function summarizeGift(msg) {
  const giftName =
    msg?.giftName ||
    msg?.gift?.giftName ||
    msg?.gift?.name ||
    msg?.gift?.gift?.giftName ||
    msg?.gift?.gift?.name ||
    msg?.gift?.giftType ||
    "";

  const repeatCountRaw =
    msg?.repeatCount ?? msg?.repeat ?? msg?.giftCount ?? msg?.amount ?? msg?.gift?.repeatCount ?? msg?.gift?.repeat ?? null;
  const repeatCount = Number(repeatCountRaw);

  const diamondCountRaw = msg?.diamondCount ?? msg?.gift?.diamondCount ?? msg?.gift?.diamond ?? msg?.gift?.cost ?? null;
  const diamondCount = Number(diamondCountRaw);

  const parts = [];
  const name = String(giftName || "").trim();
  if (name) parts.push(name);
  if (Number.isFinite(repeatCount) && repeatCount > 1) {
    if (parts.length) parts[0] = `${parts[0]} x${repeatCount}`;
    else parts.push(`x${repeatCount}`);
  }
  if (Number.isFinite(diamondCount) && diamondCount > 0) {
    parts.push(`${diamondCount} diamonds`);
  }

  const out = parts.join(" • ").trim();
  if (out) return out;

  try {
    return JSON.stringify(msg).slice(0, 220);
  } catch {
    return "gift";
  }
}

function maybeNotifyGiftSent({ host, viewer, giftSummary }) {
  const settings = getSettings();
  if (!settings.giftNotify) return;
  if (!host || !viewer) return;

  const cooldownMs = clampGiftNotifyCooldownSeconds(settings.giftNotifyCooldownSeconds) * 1000;
  const key = `${host}|${viewer}`;
  const prev = lastGiftNotifyAt.get(key) || 0;
  if (cooldownMs > 0 && Date.now() - prev < cooldownMs) return;
  lastGiftNotifyAt.set(key, Date.now());

  const n = new Notification({
    title: `@${viewer} изпрати Gift`,
    body: `в @${host}${giftSummary ? ` • ${giftSummary}` : ""}`
  });
  n.on("click", () => openChatPopup(host));
  playSound();
  n.show();
}

function isRateLimitedNow() {
  const now = Date.now();
  return now < nextAllowedCheckAt || now < joinCooldownUntil;
}

function recordRateLimit(where, errMsg) {
  const until = Date.now() + RATE_LIMIT_COOLDOWN_MS;
  nextAllowedCheckAt = Math.max(nextAllowedCheckAt, until);
  joinCooldownUntil = Math.max(joinCooldownUntil, until);
  appendHistory({
    type: "error",
    username: null,
    reason: "rate_limited",
    error: `${where}: ${String(errMsg || "").slice(0, 260)}`
  });
  broadcastAppStatus();
  broadcastJoinTracker();
}

function getAppStatus() {
  const now = Date.now();
  const rateLimitedUntil = Math.max(nextAllowedCheckAt || 0, joinCooldownUntil || 0);
  const rateLimited = now < rateLimitedUntil;
  const statusThrottledUntil =
    joinTrackerActive && joinTrackingMode === "allLive"
      ? Math.max(0, (lastStatusCheckAt || 0) + STATUS_MIN_INTERVAL_WHEN_ALLLIVE_MS)
      : 0;
  const statusThrottled = joinTrackerActive && joinTrackingMode === "allLive" && now < statusThrottledUntil;

  const settings = getSettings();
  return {
    now,
    rateLimited,
    rateLimitedUntil,
    statusThrottled,
    statusThrottledUntil,
    joinTrackerActive,
    joinTrackingMode,
    joinTrackedHost,
    autoTrackAllLive: Boolean(settings.autoTrackAllLive),
    // health
    isChecking,
    lastStatusCheckAt,
    nextScheduledCheckAt,
    intervalMinutes: clampIntervalMinutes(settings.intervalMinutes),
    userCount: Array.isArray(settings.usernames) ? settings.usernames.length : 0,
    watchUsersCount: Array.isArray(watchUsers) ? watchUsers.length : 0,
    historyCount: Array.isArray(history) ? history.length : 0,
    zerodySocketConnected: Boolean(zerodySocket && zerodySocket.connected),
    joinTrackerSocketConnected: Boolean(joinTrackerSocket && joinTrackerSocket.connected)
  };
}

function broadcastAppStatus() {
  const payload = getAppStatus();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("app-status-updated", payload);
  }
  // also update tray icon quickly when entering/leaving cooldown
  updateTrayTitle();
}

function broadcastNotificationsState() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("notifications-state-updated", getNotificationsState());
  }
}

async function clearAppCacheNow() {
  try {
    // Chromium HTTP cache, etc.
    await session.defaultSession.clearCache();
  } catch {
    // ignore
  }
  try {
    await session.defaultSession.clearAuthCache();
  } catch {
    // ignore
  }
  try {
    await session.defaultSession.clearCodeCaches({});
  } catch {
    // ignore
  }
  return { ok: true };
}

function relaunchApp({ clearCache } = {}) {
  try {
    const baseArgs = process.argv.slice(1).filter((a) => a !== CLEAR_CACHE_ON_START_FLAG);
    const args = clearCache ? [...baseArgs, CLEAR_CACHE_ON_START_FLAG] : baseArgs;
    app.relaunch({ args });
  } catch {
    // fallback
    try {
      app.relaunch();
    } catch {
      // ignore
    }
  }
  app.exit(0);
}

function factoryReset() {
  try {
    store.clear();
  } catch {
    // ignore
  }

  // Reset in-memory state immediately for current session (before restart)
  lastState = { byUser: {} };
  history = [];
  watchUsers = [];
  joinEvents = [];
  joinTrackedHost = null;
  joinTrackerActive = false;
  joinTrackingMode = "single";
  joinCooldownUntil = 0;
  nextAllowedCheckAt = 0;
  lastStatusCheckAt = 0;
  nextScheduledCheckAt = 0;

  broadcastSettings();
  broadcastState();
  broadcastHistory();
  broadcastJoinTracker();
  broadcastNotificationsState();
  broadcastAppStatus();

  // Restart and clear caches to ensure a clean slate
  relaunchApp({ clearCache: true });
}

function saveLastState() {
  store.set(LAST_STATE_KEY, lastState);
}

function appendHistory(entry) {
  const e = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    ts: Date.now(),
    ...entry
  };
  history.unshift(e);
  if (history.length > HISTORY_LIMIT) history = history.slice(0, HISTORY_LIMIT);
  store.set(HISTORY_KEY, history);
  broadcastHistory();
}

function getWatchUsersNormalized() {
  return uniqUsernames(watchUsers);
}

function saveWatchUsers(next) {
  watchUsers = uniqUsernames(next);
  store.set(WATCH_USERS_KEY, watchUsers);
  broadcastJoinTracker();
  return watchUsers;
}

function appendJoinEvent(entry) {
  const e = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    ts: Date.now(),
    ...entry
  };
  joinEvents.unshift(e);
  if (joinEvents.length > JOIN_EVENTS_LIMIT) joinEvents = joinEvents.slice(0, JOIN_EVENTS_LIMIT);
  store.set(JOIN_EVENTS_KEY, joinEvents);
  broadcastJoinTracker();
}

function clampIntervalMinutes(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return DEFAULTS.intervalMinutes;
  return Math.max(1, Math.min(60, Math.round(num)));
}

function normalizePerHostIntervals(v) {
  const input = v && typeof v === "object" ? v : {};
  const out = {};
  for (const [k, val] of Object.entries(input)) {
    const u = normalizeUsername(k);
    if (!u) continue;
    const m = clampIntervalMinutes(val);
    out[u] = m;
  }
  return out;
}

function getPolicyIntervalMinutesFor(username, settings) {
  const u = normalizeUsername(username);
  const map = normalizePerHostIntervals(settings?.perHostIntervals || store.get("perHostIntervals") || {});
  const override = map[u];
  if (override) return clampIntervalMinutes(override);
  return clampIntervalMinutes(settings?.intervalMinutes ?? store.get("intervalMinutes"));
}

function clampJoinNotifyCooldownMinutes(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return DEFAULTS.joinNotifyCooldownMinutes;
  return Math.max(0, Math.min(180, Math.round(num)));
}

function normalizeSoundType(t) {
  const v = String(t || "").trim();
  if (v === "beep" || v === "chime" || v === "alert" || v === "custom") return v;
  return DEFAULTS.soundType;
}

function normalizeThemeMode(v) {
  const t = String(v || "").trim();
  if (t === "system" || t === "dark" || t === "light") return t;
  return DEFAULTS.themeMode;
}

function normalizeAccent(v) {
  const a = String(v || "").trim();
  if (["violet", "blue", "teal", "green", "amber", "red"].includes(a)) return a;
  return DEFAULTS.accent;
}

function normalizeDensity(v) {
  const d = String(v || "").trim();
  if (d === "comfortable" || d === "compact") return d;
  return DEFAULTS.density;
}

function normalizeDashboardView(v) {
  const t = String(v || "").trim();
  if (t === "table" || t === "kanban") return t;
  return DEFAULTS.dashboardView;
}

function normalizeUsername(u) {
  return String(u || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
}

function uniqUsernames(arr) {
  const out = [];
  const seen = new Set();
  for (const v of arr || []) {
    const u = normalizeUsername(v);
    if (!u) continue;
    if (seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
}

function getSettings() {
  return {
    usernames: uniqUsernames(store.get("usernames")),
    intervalMinutes: clampIntervalMinutes(store.get("intervalMinutes")),
    perHostIntervals: normalizePerHostIntervals(store.get("perHostIntervals")),
    joinNotify: Boolean(store.get("joinNotify")),
    joinNotifyCooldownMinutes: clampJoinNotifyCooldownMinutes(store.get("joinNotifyCooldownMinutes")),
    autoTrackAllLive: Boolean(store.get("autoTrackAllLive")),
    giftTrack: Boolean(store.get("giftTrack")),
    giftNotify: Boolean(store.get("giftNotify")),
    giftNotifyCooldownSeconds: clampGiftNotifyCooldownSeconds(store.get("giftNotifyCooldownSeconds")),
    soundEnabled: Boolean(store.get("soundEnabled")),
    soundType: normalizeSoundType(store.get("soundType")),
    soundCustomPath: String(store.get("soundCustomPath") || ""),
    themeMode: normalizeThemeMode(store.get("themeMode")),
    accent: normalizeAccent(store.get("accent")),
    density: normalizeDensity(store.get("density")),
    dashboardView: normalizeDashboardView(store.get("dashboardView")),
    obsParams: String(store.get("obsParams") || DEFAULTS.obsParams).trim() || DEFAULTS.obsParams
  };
}

function setSettings(next) {
  const normalized = {
    usernames: uniqUsernames(next.usernames),
    intervalMinutes: clampIntervalMinutes(next.intervalMinutes),
    perHostIntervals: normalizePerHostIntervals(next.perHostIntervals),
    joinNotify: Boolean(next.joinNotify),
    joinNotifyCooldownMinutes: clampJoinNotifyCooldownMinutes(next.joinNotifyCooldownMinutes),
    autoTrackAllLive: Boolean(next.autoTrackAllLive),
    giftTrack: Boolean(next.giftTrack),
    giftNotify: Boolean(next.giftNotify),
    giftNotifyCooldownSeconds: clampGiftNotifyCooldownSeconds(next.giftNotifyCooldownSeconds),
    soundEnabled: Boolean(next.soundEnabled),
    soundType: normalizeSoundType(next.soundType),
    soundCustomPath: String(next.soundCustomPath || ""),
    themeMode: normalizeThemeMode(next.themeMode),
    accent: normalizeAccent(next.accent),
    density: normalizeDensity(next.density),
    dashboardView: normalizeDashboardView(next.dashboardView),
    obsParams: String(next.obsParams || "").trim() || DEFAULTS.obsParams
  };
  store.set(normalized);
  scheduleChecks();
  broadcastSettings();
  return normalized;
}

function obsReaderUrl(username, obsParams) {
  const base = "https://tiktok-chat-reader.zerody.one/obs.html";
  return `${base}?username=${encodeURIComponent(username)}&${obsParams}`;
}

function ensureSoundWindow() {
  if (soundWindow && !soundWindow.isDestroyed()) return soundWindow;

  soundWindow = new BrowserWindow({
    show: false,
    width: 320,
    height: 240,
    backgroundColor: "#0f0f16",
    webPreferences: {
      preload: path.join(__dirname, "sound_preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  soundWindow.setMenuBarVisibility(false);
  soundWindow.loadFile(path.join(__dirname, "renderer", "sound.html"));
  soundWindow.on("closed", () => {
    soundWindow = null;
  });
  return soundWindow;
}

function playSoundPayload({ type, customPath }) {
  const kind = normalizeSoundType(type);
  if (kind === "beep") {
    shell.beep();
    return;
  }

  const win = ensureSoundWindow();
  win.webContents.send("play-sound", {
    type: kind,
    customPath: String(customPath || "")
  });
}

function playSound(kindOverride) {
  const settings = getSettings();
  if (!settings.soundEnabled) return;

  playSoundPayload({
    type: kindOverride || settings.soundType,
    customPath: settings.soundCustomPath || ""
  });
}

function getMainParent() {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
  return undefined;
}

function createPrettyPopupWindow({
  title,
  width,
  height,
  minWidth,
  minHeight,
  preload,
  url
} = {}) {
  const win = new BrowserWindow({
    width,
    height,
    minWidth,
    minHeight,
    title,
    show: false,
    backgroundColor: "#0f0f16",
    roundedCorners: true,
    autoHideMenuBar: true,
    parent: getMainParent(),
    modal: false,
    skipTaskbar: true,
    webPreferences: {
      preload: preload || undefined,
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.setMenuBarVisibility(false);
  win.center();

  win.once("ready-to-show", () => {
    if (win.isDestroyed()) return;
    win.show();
    win.focus();
  });

  if (url) {
    win.loadURL(url).catch(() => {});
  }

  return win;
}

function openChatPopup(username) {
  const u = normalizeUsername(username);
  if (!u) return null;

  const existing = chatWindows.get(u);
  if (existing && !existing.isDestroyed()) {
    existing.show();
    existing.focus();
    return existing;
  }

  const settings = getSettings();
  const url = obsReaderUrl(u, settings.obsParams);

  try {
    const win = createPrettyPopupWindow({
      width: 520,
      height: 740,
      minWidth: 360,
      minHeight: 420,
      title: `@${u} — Chat`,
      url
    });

    win.webContents.on("did-fail-load", (_e, errorCode, errorDesc, validatedURL) => {
      appendHistory({
        type: "error",
        username: u,
        reason: "chat_load_failed",
        error: `did-fail-load ${errorCode}: ${errorDesc} (${validatedURL})`
      });
      dialog.showErrorBox(
        "Chat прозорецът не се зареди",
        `Не успях да заредя overlay-а за @${u}.\n\n${errorDesc}\nURL: ${validatedURL}`
      );
    });

    // show even if ready-to-show didn't fire (rare)
    win.webContents.once("did-finish-load", () => {
      if (!win.isDestroyed() && !win.isVisible()) win.show();
    });

    win.on("closed", () => {
      chatWindows.delete(u);
    });

    chatWindows.set(u, win);
    return win;
  } catch (err) {
    appendHistory({
      type: "error",
      username: u,
      reason: "chat_window_error",
      error: String(err?.message || err)
    });
    return null;
  }
}

function openHistoryPopup() {
  if (historyWindow && !historyWindow.isDestroyed()) {
    historyWindow.show();
    historyWindow.focus();
    return historyWindow;
  }

  historyWindow = createPrettyPopupWindow({
    width: 860,
    height: 720,
    minWidth: 640,
    minHeight: 520,
    title: "История и логове",
    preload: path.join(__dirname, "preload.js")
  });
  historyWindow.loadFile(path.join(__dirname, "renderer", "history.html"));

  historyWindow.on("closed", () => {
    historyWindow = null;
  });

  historyWindow.webContents.once("did-finish-load", () => {
    if (historyWindow && !historyWindow.isDestroyed()) {
      historyWindow.webContents.send("history-updated", history);
    }
  });

  return historyWindow;
}

function openSettingsPopup() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return settingsWindow;
  }

  settingsWindow = createPrettyPopupWindow({
    width: 920,
    height: 740,
    minWidth: 720,
    minHeight: 560,
    title: "Профили и настройки",
    preload: path.join(__dirname, "preload.js")
  });
  settingsWindow.loadFile(path.join(__dirname, "renderer", "settings.html"));

  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });

  settingsWindow.webContents.once("did-finish-load", () => {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.webContents.send("settings-updated", getSettings());
    }
  });

  return settingsWindow;
}

function openJoinTrackerPopup(hostUsername) {
  if (joinTrackerWindow && !joinTrackerWindow.isDestroyed()) {
    joinTrackerWindow.show();
    joinTrackerWindow.focus();
  } else {
    joinTrackerWindow = createPrettyPopupWindow({
      width: 980,
      height: 760,
      minWidth: 760,
      minHeight: 560,
      title: "Join Tracker",
      preload: path.join(__dirname, "preload.js")
    });
    joinTrackerWindow.loadFile(path.join(__dirname, "renderer", "join-tracker.html"));
    joinTrackerWindow.on("closed", () => {
      joinTrackerWindow = null;
    });
    joinTrackerWindow.webContents.once("did-finish-load", () => {
      broadcastJoinTracker();
      joinTrackerWindow.webContents.send("settings-updated", getSettings());
    });
  }

  if (hostUsername) {
    startJoinTracking(hostUsername).catch(() => {});
  }

  return joinTrackerWindow;
}

function broadcastState() {
  if (!mainWindow) return;
  mainWindow.webContents.send("state-updated", lastState);
}

function broadcastSettings() {
  const settings = getSettings();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("settings-updated", settings);
  }
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send("settings-updated", settings);
  }
  if (joinTrackerWindow && !joinTrackerWindow.isDestroyed()) {
    joinTrackerWindow.webContents.send("settings-updated", settings);
  }
}

function broadcastHistory() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("history-updated", history);
  }
  if (historyWindow && !historyWindow.isDestroyed()) {
    historyWindow.webContents.send("history-updated", history);
  }
}

function broadcastJoinTracker() {
  const payload = {
    watchUsers: getWatchUsersNormalized(),
    joinEvents,
    trackedHost: joinTrackedHost,
    active: joinTrackerActive,
    cooldownUntil: joinCooldownUntil,
    mode: joinTrackingMode
  };
  if (joinTrackerWindow && !joinTrackerWindow.isDestroyed()) {
    joinTrackerWindow.webContents.send("join-tracker-updated", payload);
  }
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function ensureZerodySocket() {
  if (zerodySocket) return zerodySocket;

  zerodySocket = io("https://tiktok-chat-reader.zerody.one", {
    transports: ["websocket"],
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1500,
    reconnectionDelayMax: 8000,
    timeout: 8000
  });

  zerodySocket.on("connect_error", (err) => {
    appendHistory({
      type: "error",
      username: null,
      reason: "zerody_connect_error",
      error: String(err?.message || err)
    });
  });

  return zerodySocket;
}

function ensureJoinTrackerSocket() {
  if (joinTrackerSocket) return joinTrackerSocket;

  joinTrackerSocket = io("https://tiktok-chat-reader.zerody.one", {
    transports: ["websocket"],
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 2000,
    reconnectionDelayMax: 12000,
    timeout: 8000
  });

  joinTrackerSocket.on("connect_error", (err) => {
    appendHistory({
      type: "error",
      username: joinTrackedHost,
      reason: "join_tracker_connect_error",
      error: String(err?.message || err)
    });
  });

  // Watch for "member joined" events. Zerody emits `member` with payload containing `uniqueId`.
  joinTrackerSocket.on("member", (msg) => {
    if (!joinTrackerActive) return;
    const viewer = normalizeUsername(msg?.uniqueId || msg?.uniqueID || msg?.user?.uniqueId || "");
    if (!viewer) return;
    const watchSet = new Set(getWatchUsersNormalized());
    if (!watchSet.has(viewer)) return;

    appendJoinEvent({
      type: "viewer_joined",
      host: joinTrackedHost,
      viewer
    });

    // Also record in global History (for notification center)
    appendHistory({
      type: "viewer_joined",
      username: joinTrackedHost,
      reason: "join",
      error: viewer
    });

    maybeNotifyViewerJoined({ host: joinTrackedHost, viewer });
  });

  // Gift events (sent by viewers)
  joinTrackerSocket.on("gift", (msg) => {
    if (!joinTrackerActive) return;
    const settings = getSettings();
    if (!settings.giftTrack) return;

    const viewer = normalizeUsername(
      msg?.uniqueId || msg?.uniqueID || msg?.user?.uniqueId || msg?.user?.uniqueID || msg?.userId || msg?.user?.userId || ""
    );
    if (!viewer) return;
    const watchSet = new Set(getWatchUsersNormalized());
    if (!watchSet.has(viewer)) return;

    const giftSummary = summarizeGift(msg);

    appendJoinEvent({
      type: "gift_sent",
      host: joinTrackedHost,
      viewer,
      error: giftSummary
    });

    // Also record in global History (for notification center)
    appendHistory({
      type: "gift_sent",
      username: joinTrackedHost,
      reason: "gift",
      error: `${viewer}${giftSummary ? ` • ${giftSummary}` : ""}`
    });

    maybeNotifyGiftSent({ host: joinTrackedHost, viewer, giftSummary });
  });

  joinTrackerSocket.on("streamEnd", () => {
    if (!joinTrackerActive) return;
    appendJoinEvent({ type: "stream_end", host: joinTrackedHost, viewer: null });
  });

  joinTrackerSocket.on("tiktokDisconnected", (msg) => {
    const errMsg = typeof msg === "string" ? msg : JSON.stringify(msg);
    const lower = String(errMsg).toLowerCase();
    const rateLimited = lower.includes("too many connections") || lower.includes("too many connection requests");
    if (rateLimited) {
      recordRateLimit("joinTracker", errMsg);
    }
    if (joinTrackerActive) {
      appendJoinEvent({
        type: "tiktok_disconnected",
        host: joinTrackedHost,
        viewer: null,
        error: errMsg
      });
    }
  });

  return joinTrackerSocket;
}

async function ensureJoinTrackerConnected() {
  const socket = ensureJoinTrackerSocket();
  if (socket.connected) return true;
  if (joinTrackerConnecting) return joinTrackerConnecting;

  joinTrackerConnecting = new Promise((resolve) => {
    const t = setTimeout(() => resolve(false), 8000);
    socket.once("connect", () => {
      clearTimeout(t);
      resolve(true);
    });
    socket.once("connect_error", () => {
      clearTimeout(t);
      resolve(false);
    });
    try {
      socket.connect();
    } catch {
      clearTimeout(t);
      resolve(false);
    }
  }).finally(() => {
    joinTrackerConnecting = null;
  });

  return joinTrackerConnecting;
}

function getAllLiveHostsFromState() {
  const byUser = lastState?.byUser || {};
  const live = Object.values(byUser)
    .filter((x) => x?.isLive === true && x?.username)
    .map((x) => normalizeUsername(x.username))
    .filter(Boolean);
  return uniqUsernames(live);
}

async function startJoinTrackingAllLive() {
  if (Date.now() < joinCooldownUntil) {
    return { ok: false, error: `cooldown until ${new Date(joinCooldownUntil).toLocaleTimeString()}` };
  }

  const connected = await ensureJoinTrackerConnected();
  if (!connected) return { ok: false, error: "join tracker socket not connected" };

  joinTrackingMode = "allLive";
  joinTrackerActive = true;
  joinTrackedHost = null;
  broadcastJoinTracker();
  appendJoinEvent({ type: "tracking_all_live_started", host: null, viewer: null });

  const abortId = ++joinRotationAbortId;
  const dwellMs = JOIN_DWELL_MS; // how long to listen per host before rotating

  (async () => {
    while (joinTrackerActive && joinTrackingMode === "allLive" && joinRotationAbortId === abortId) {
      const liveHosts = getAllLiveHostsFromState();
      if (!liveHosts.length) {
        joinTrackedHost = null;
        broadcastJoinTracker();
        await delay(15000);
        continue;
      }

      for (const host of liveHosts) {
        if (!joinTrackerActive || joinTrackingMode !== "allLive" || joinRotationAbortId !== abortId) return;
        if (Date.now() < joinCooldownUntil) return;

        const now = Date.now();
        const since = now - lastJoinSwitchAt;
        if (since < JOIN_SWITCH_MIN_INTERVAL_MS) {
          await delay(JOIN_SWITCH_MIN_INTERVAL_MS - since);
        }

        joinTrackedHost = host;
        lastJoinSwitchAt = Date.now();
        broadcastJoinTracker();

        try {
          ensureJoinTrackerSocket().emit("setUniqueId", host, { enableExtendedGiftInfo: true });
          appendJoinEvent({ type: "tracking_host", host, viewer: null });
        } catch (err) {
          appendJoinEvent({
            type: "emit_failed",
            host,
            viewer: null,
            error: String(err?.message || err)
          });
        }

        await delay(dwellMs);
      }
    }
  })().catch(() => {});

  return { ok: true };
}

async function startJoinTracking(hostUsername) {
  const host = normalizeUsername(hostUsername);
  if (!host) return { ok: false, error: "missing host" };
  if (Date.now() < joinCooldownUntil) {
    return { ok: false, error: `cooldown until ${new Date(joinCooldownUntil).toLocaleTimeString()}` };
  }

  const connected = await ensureJoinTrackerConnected();
  if (!connected) return { ok: false, error: "join tracker socket not connected" };

  joinTrackingMode = "single";
  joinRotationAbortId++; // stop any running rotation loop
  joinTrackedHost = host;
  lastJoinSwitchAt = Date.now();
  joinTrackerActive = true;
  broadcastJoinTracker();

  const socket = ensureJoinTrackerSocket();
  socket.emit("setUniqueId", host, { enableExtendedGiftInfo: true });
  appendJoinEvent({ type: "tracking_started", host, viewer: null });
  return { ok: true };
}

async function stopJoinTracking() {
  joinTrackerActive = false;
  joinRotationAbortId++;
  appendJoinEvent({
    type: joinTrackingMode === "allLive" ? "tracking_all_live_stopped" : "tracking_stopped",
    host: joinTrackedHost,
    viewer: null
  });
  joinTrackingMode = "single";
  joinTrackedHost = null;
  broadcastJoinTracker();
  return { ok: true };
}

async function ensureZerodyConnected() {
  const socket = ensureZerodySocket();
  if (socket.connected) return true;
  if (zerodyConnecting) return zerodyConnecting;

  zerodyConnecting = new Promise((resolve) => {
    const t = setTimeout(() => resolve(false), 8000);
    socket.once("connect", () => {
      clearTimeout(t);
      resolve(true);
    });
    socket.once("connect_error", () => {
      clearTimeout(t);
      resolve(false);
    });
    try {
      socket.connect();
    } catch {
      clearTimeout(t);
      resolve(false);
    }
  }).finally(() => {
    zerodyConnecting = null;
  });

  return zerodyConnecting;
}

async function checkUserLive(username) {
  const startedAt = Date.now();
  const timeoutMs = 12000;

  const connected = await ensureZerodyConnected();
  if (!connected) {
    return {
      username,
      checkedAt: Date.now(),
      durationMs: Date.now() - startedAt,
      ok: false,
      isLive: null,
      confidence: "low",
      reason: "zerody_not_connected",
      error: "Zerody socket not connected"
    };
  }

  const socket = ensureZerodySocket();

  return await new Promise((resolve) => {
    let done = false;
    const timerId = setTimeout(() => {
      cleanup();
      resolve({
        username,
        checkedAt: Date.now(),
        durationMs: Date.now() - startedAt,
        ok: false,
        isLive: null,
        confidence: "low",
        reason: "timeout",
        error: `Zerody timeout (${timeoutMs}ms)`
      });
    }, timeoutMs);

    const cleanup = () => {
      if (done) return;
      done = true;
      clearTimeout(timerId);
      socket.off("tiktokConnected", onConnected);
      socket.off("tiktokDisconnected", onDisconnected);
      socket.off("streamEnd", onStreamEnd);
    };

    const onConnected = (state) => {
      cleanup();
      resolve({
        username,
        checkedAt: Date.now(),
        durationMs: Date.now() - startedAt,
        ok: true,
        isLive: true,
        confidence: "high",
        roomId: state?.roomId ?? null,
        reason: null,
        error: null
      });
    };

    const onStreamEnd = () => {
      cleanup();
      resolve({
        username,
        checkedAt: Date.now(),
        durationMs: Date.now() - startedAt,
        ok: true,
        isLive: false,
        confidence: "high",
        reason: "streamEnd",
        error: null
      });
    };

    const onDisconnected = (msg) => {
      const errMsg = typeof msg === "string" ? msg : JSON.stringify(msg);
      const lower = String(errMsg).toLowerCase();
      const ended = lower.includes("live has ended");
      const rateLimited = lower.includes("too many connections") || lower.includes("too many connection requests");

      if (rateLimited) {
        recordRateLimit("status", errMsg);
      }

      cleanup();
      resolve({
        username,
        checkedAt: Date.now(),
        durationMs: Date.now() - startedAt,
        ok: ended,
        isLive: ended ? false : null,
        confidence: ended ? "high" : "low",
        reason: ended ? "streamEnded" : rateLimited ? "rate_limited" : "tiktokDisconnected",
        error: errMsg
      });
    };

    socket.on("tiktokConnected", onConnected);
    socket.on("tiktokDisconnected", onDisconnected);
    socket.on("streamEnd", onStreamEnd);

    try {
      socket.emit("setUniqueId", username, { enableExtendedGiftInfo: true });
    } catch (err) {
      cleanup();
      resolve({
        username,
        checkedAt: Date.now(),
        durationMs: Date.now() - startedAt,
        ok: false,
        isLive: null,
        confidence: "low",
        reason: "emit_failed",
        error: String(err?.message || err)
      });
    }
  });
}

function notifyLiveStarted(username) {
  const settings = getSettings();
  const targetUrl = obsReaderUrl(username, settings.obsParams);

  playSound();
  const n = new Notification({
    title: `${username} е LIVE`,
    body: "Натисни за отваряне на overlay-а."
  });
  n.on("click", () => shell.openExternal(targetUrl));
  n.show();
}

async function checkUserLiveWithRetry(username) {
  // Two retries for transient socket/proxy drops.
  const maxAttempts = 3;
  let last = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const r = await checkUserLive(username);
    last = r;
    // If we got a decisive answer, stop.
    if (r?.ok === true && (r.isLive === true || r.isLive === false)) return r;
    if (r?.reason === "rate_limited" || isRateLimitedNow()) return r;
    if (attempt < maxAttempts) {
      const jitter = Math.floor(Math.random() * 220);
      await delay(350 * attempt + jitter);
    }
  }
  return last;
}

async function maybeAutoStartJoinTrackingAllLive(settings) {
  const s = settings || getSettings();
  if (!s.autoTrackAllLive) return;
  if (Date.now() < joinCooldownUntil) return;
  if (joinTrackerActive && joinTrackingMode === "single") return; // user intentionally tracking one host
  if (joinTrackerActive && joinTrackingMode === "allLive") return;

  const live = getAllLiveHostsFromState();
  if (!live.length) return;

  await startJoinTrackingAllLive();
}

async function runCheck() {
  if (isChecking) {
    rerunQueued = true;
    return;
  }
  isChecking = true;

  if (Date.now() < nextAllowedCheckAt) {
    appendHistory({
      type: "error",
      username: null,
      reason: "rate_limit_cooldown",
      error: `Skipping checks until ${new Date(nextAllowedCheckAt).toLocaleTimeString()}`
    });
    broadcastAppStatus();
    isChecking = false;
    return;
  }

  // Auto-throttle Status checks while Join Tracker is in "allLive" mode to reduce Zerody rate limits.
  if (joinTrackerActive && joinTrackingMode === "allLive") {
    const now = Date.now();
    if (now - lastStatusCheckAt < STATUS_MIN_INTERVAL_WHEN_ALLLIVE_MS) {
      appendHistory({
        type: "error",
        username: null,
        reason: "status_throttled",
        error: `Join Tracker (all live) active — skipping status check until ${new Date(
          lastStatusCheckAt + STATUS_MIN_INTERVAL_WHEN_ALLLIVE_MS
        ).toLocaleTimeString()}`
      });
      broadcastAppStatus();
      isChecking = false;
      return;
    }
  }

  const settings = getSettings();
  const next = { ...lastState, byUser: { ...(lastState.byUser || {}) } };
  let executed = 0;

  for (const u of settings.usernames) {
    const policyMin = getPolicyIntervalMinutesFor(u, settings);
    const policyMs = policyMin * 60 * 1000;
    const prev0 = next.byUser[u] || {};
    const lastChecked = prev0.checkedAt || 0;
    const dueAt = lastChecked ? lastChecked + policyMs : 0;

    // If not due yet, keep previous state but update policy metadata.
    if (lastChecked && Date.now() < dueAt) {
      next.byUser[u] = {
        ...prev0,
        username: u,
        policyIntervalMinutes: policyMin,
        nextDueAt: dueAt
      };
      continue;
    }

    // small gap between users to reduce backend rate-limits
    if (u !== settings.usernames[0]) await delay(350 + Math.floor(Math.random() * 220));
    const r = await checkUserLiveWithRetry(u);
    executed++;
    const prev = next.byUser[r.username] || {};
    const wasLive = prev.isLive === true;
    const isLive = r.isLive === true;

    next.byUser[r.username] = {
      username: r.username,
      ok: r.ok,
      isLive: r.isLive,
      confidence: r.confidence,
      checkedAt: r.checkedAt,
      durationMs: r.durationMs,
      roomId: r.roomId ?? null,
      reason: r.reason ?? null,
      error: r.error ?? null,
      lastChangeAt: isLive !== wasLive ? r.checkedAt : prev.lastChangeAt || null,
      // "When was this profile last seen LIVE" (useful even when currently offline/unknown)
      lastLiveSeenAt: isLive ? r.checkedAt : prev.lastLiveSeenAt || null,
      lastLiveStartedAt: !wasLive && isLive ? r.checkedAt : prev.lastLiveStartedAt || null,
      lastLiveEndedAt: wasLive && r.isLive === false ? r.checkedAt : prev.lastLiveEndedAt || null,
      policyIntervalMinutes: policyMin,
      nextDueAt: r.checkedAt + policyMs
    };

    if (r.ok === false) {
      appendHistory({
        type: "error",
        username: r.username,
        reason: r.reason ?? null,
        error: r.error ?? null
      });
    }

    if (!wasLive && isLive) {
      appendHistory({ type: "live_started", username: r.username, roomId: r.roomId ?? null });
      notifyLiveStarted(r.username);
    }

    if (wasLive && r.isLive === false) {
      appendHistory({ type: "live_ended", username: r.username });
    }
  }

  lastState = next;
  saveLastState();
  broadcastState();
  updateTrayTitle();
  if (executed > 0) lastStatusCheckAt = Date.now();
  broadcastAppStatus();
  await maybeAutoStartJoinTrackingAllLive(settings);

  isChecking = false;
  if (rerunQueued) {
    rerunQueued = false;
    // run once more (e.g. user clicked "check now" while we were busy)
    await runCheck();
  }
}

function scheduleChecks() {
  if (scheduleTimeout) clearTimeout(scheduleTimeout);
  const settings = getSettings();
  const base = clampIntervalMinutes(settings.intervalMinutes);
  const per = Object.values(normalizePerHostIntervals(settings.perHostIntervals || {}));
  const minPer = per.length ? Math.min(...per) : base;
  const ms = Math.min(base, minPer) * 60 * 1000;
  nextScheduledCheckAt = Date.now() + ms;
  broadcastAppStatus();
  scheduleTimeout = setTimeout(async () => {
    await runCheck();
    scheduleChecks();
  }, ms);
}

function updateTrayTitle() {
  if (!tray) return;
  const byUser = lastState.byUser || {};
  const liveCount = Object.values(byUser).filter((x) => x?.isLive === true).length;
  const unknownCount = Object.values(byUser).filter((x) => x?.isLive == null).length;
  tray.setToolTip(
    liveCount
      ? `TikTok LIVE Watcher — ${liveCount} LIVE`
      : unknownCount
        ? `TikTok LIVE Watcher — ${unknownCount} unknown`
        : "TikTok LIVE Watcher"
  );
  updateTrayIcon({ liveCount, unknownCount });
}

function svgDataUrl(svg) {
  // Safe for nativeImage.createFromDataURL
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function trayIconSvg(color) {
  // 24x24 circle with subtle border
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="8.5" fill="${color}" stroke="rgba(0,0,0,0.35)" stroke-width="1"/>
    </svg>
  `.trim();
}

let lastTrayIconKey = null;
function updateTrayIcon({ liveCount, unknownCount }) {
  if (!tray) return;
  const status = getAppStatus();
  let key = "idle";
  let color = "#9CA3AF"; // gray
  if (status?.rateLimited) {
    key = "cooldown";
    color = "#F59E0B"; // amber
  } else if (liveCount > 0) {
    key = "live";
    color = "#22C55E"; // green
  } else if (unknownCount > 0) {
    key = "unknown";
    color = "#FBBF24"; // yellow
  }

  if (key === lastTrayIconKey) return;
  lastTrayIconKey = key;
  const img = nativeImage.createFromDataURL(svgDataUrl(trayIconSvg(color)));
  tray.setImage(img);
}

function createWindow() {
  const savedBounds = store.get("windowBounds");
  const defaultBounds = { width: 980, height: 760 };
  const bounds =
    savedBounds &&
    typeof savedBounds === "object" &&
    Number.isFinite(savedBounds.width) &&
    Number.isFinite(savedBounds.height)
      ? {
          x: Number.isFinite(savedBounds.x) ? savedBounds.x : undefined,
          y: Number.isFinite(savedBounds.y) ? savedBounds.y : undefined,
          width: Math.max(720, savedBounds.width),
          height: Math.max(560, savedBounds.height)
        }
      : defaultBounds;

  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 720,
    minHeight: 560,
    show: true,
    backgroundColor: "#18171c",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));

  // Dev-friendly shortcuts (only while the app window is focused):
  // - Ctrl+R: hard reload (ignore cache)
  // - F12 / Ctrl+Shift+I: toggle DevTools
  mainWindow.webContents.on("before-input-event", (event, input) => {
    const key = String(input.key || "");
    const lower = key.toLowerCase();
    const ctrlOrCmd = input.control || input.meta;

    if (ctrlOrCmd && !input.shift && !input.alt && lower === "r") {
      event.preventDefault();
      mainWindow.webContents.reloadIgnoringCache();
      return;
    }

    if (key === "F12" || (ctrlOrCmd && input.shift && lower === "i")) {
      event.preventDefault();
      if (mainWindow.webContents.isDevToolsOpened()) mainWindow.webContents.closeDevTools();
      else mainWindow.webContents.openDevTools({ mode: "detach" });
    }
  });

  // Persist window size/position (debounced)
  let saveTimer = null;
  const scheduleSaveBounds = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!mainWindow) return;
      const b = mainWindow.getBounds();
      store.set("windowBounds", { x: b.x, y: b.y, width: b.width, height: b.height });
    }, 350);
  };
  mainWindow.on("resize", scheduleSaveBounds);
  mainWindow.on("move", scheduleSaveBounds);

  mainWindow.on("close", (e) => {
    // Keep running in tray
    if (!app.isQuiting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on("ready-to-show", () => {
    mainWindow.show();
    mainWindow.focus();
    broadcastSettings();
    broadcastState();
  });
}

function createTray() {
  // Start with a neutral icon; we'll update based on state.
  tray = new Tray(nativeImage.createFromDataURL(svgDataUrl(trayIconSvg("#9CA3AF"))));

  const menu = Menu.buildFromTemplate([
    {
      label: "Отвори",
      click: () => {
        if (!mainWindow) createWindow();
        mainWindow.show();
        mainWindow.focus();
      }
    },
    {
      label: "Профили и настройки",
      click: () => {
        openSettingsPopup();
      }
    },
    {
      label: "Join Tracker",
      click: () => {
        openJoinTrackerPopup();
      }
    },
    { type: "separator" },
    { label: "Провери сега", click: () => void runCheck() },
    {
      label: "История и логове",
      click: () => {
        openHistoryPopup();
      }
    },
    {
      label: "Reload UI",
      click: () => {
        if (!mainWindow) createWindow();
        mainWindow.webContents.reloadIgnoringCache();
        mainWindow.show();
        mainWindow.focus();
      }
    },
    {
      label: "Toggle DevTools",
      click: () => {
        if (!mainWindow) createWindow();
        if (mainWindow.webContents.isDevToolsOpened()) mainWindow.webContents.closeDevTools();
        else mainWindow.webContents.openDevTools({ mode: "detach" });
        mainWindow.show();
        mainWindow.focus();
      }
    },
    { type: "separator" },
    {
      label: "Restart",
      click: () => {
        relaunchApp({ clearCache: false });
      }
    },
    {
      label: "Clear cache & Restart",
      click: () => {
        relaunchApp({ clearCache: true });
      }
    },
    {
      label: "Clear cache (без рестарт)",
      click: () => void clearAppCacheNow()
    },
    {
      label: "Factory reset (изтрий настройки)",
      click: () => {
        factoryReset();
      }
    },
    { type: "separator" },
    {
      label: "Изход",
      click: () => {
        app.isQuiting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(menu);
  tray.on("double-click", () => {
    if (!mainWindow) createWindow();
    mainWindow.show();
    mainWindow.focus();
  });
  updateTrayTitle();
}

ipcMain.handle("get-settings", () => getSettings());
ipcMain.handle("set-settings", (_e, next) => setSettings(next));
ipcMain.handle("get-state", () => lastState);
ipcMain.handle("get-history", () => history);
ipcMain.handle("clear-history", () => {
  history = [];
  store.set(HISTORY_KEY, history);
  broadcastHistory();
  return true;
});
ipcMain.handle("get-notifications-state", () => getNotificationsState());
ipcMain.handle("mark-notifications-read", (_e, ts) => markNotificationsRead(ts));
ipcMain.handle("restart-app", (_e, opts) => {
  relaunchApp({ clearCache: Boolean(opts?.clearCache) });
  return { ok: true };
});
ipcMain.handle("clear-cache", async () => await clearAppCacheNow());
ipcMain.handle("factory-reset", () => {
  factoryReset();
  return { ok: true };
});

function buildConfigBundle() {
  const settings = getSettings();
  return {
    schema: "tiktok-live-watcher-config",
    version: 1,
    exportedAt: new Date().toISOString(),
    settings,
    watchUsers: getWatchUsersNormalized()
  };
}

function mergeConfigBundle(bundle, mode) {
  const b = bundle || {};
  const incomingSettings = b.settings || {};
  const incomingWatch = Array.isArray(b.watchUsers) ? b.watchUsers : [];

  const cur = getSettings();
  const nextSettings = {
    ...cur,
    ...incomingSettings,
    usernames:
      mode === "replace"
        ? uniqUsernames(incomingSettings.usernames)
        : uniqUsernames([...(cur.usernames || []), ...(incomingSettings.usernames || [])])
  };

  const nextWatchUsers =
    mode === "replace" ? uniqUsernames(incomingWatch) : uniqUsernames([...(getWatchUsersNormalized() || []), ...incomingWatch]);

  setSettings(nextSettings);
  saveWatchUsers(nextWatchUsers);
  return { ok: true, settings: getSettings(), watchUsers: getWatchUsersNormalized() };
}
ipcMain.handle("export-history-csv", async () => {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: "Export history (CSV)",
    defaultPath: path.join(appDataDir, "history.csv"),
    filters: [{ name: "CSV", extensions: ["csv"] }]
  });
  if (canceled || !filePath) return { ok: false, canceled: true };

  const header = ["ts", "type", "username", "roomId", "reason", "error"].join(",");
  const lines = history
    .slice()
    .reverse()
    .map((h) => {
      const row = [
        new Date(h.ts).toISOString(),
        h.type || "",
        h.username || "",
        h.roomId || "",
        h.reason || "",
        (h.error || "").toString().replace(/\r?\n/g, " ")
      ];
      // naive CSV escaping
      return row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",");
    });
  const csv = [header, ...lines].join("\n");
  fs.writeFileSync(filePath, csv, "utf8");
  return { ok: true, filePath };
});
ipcMain.handle("export-config-json", async () => {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: "Export config (JSON)",
    defaultPath: path.join(appDataDir, "tiktok-live-watcher-config.json"),
    filters: [{ name: "JSON", extensions: ["json"] }]
  });
  if (canceled || !filePath) return { ok: false, canceled: true };
  const json = JSON.stringify(buildConfigBundle(), null, 2);
  fs.writeFileSync(filePath, json, "utf8");
  return { ok: true, filePath };
});

ipcMain.handle("import-config-json", async (_e, opts) => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: "Import config (JSON)",
    properties: ["openFile"],
    filters: [{ name: "JSON", extensions: ["json"] }]
  });
  if (canceled || !filePaths?.[0]) return { ok: false, canceled: true };
  const raw = fs.readFileSync(filePaths[0], "utf8");
  const parsed = JSON.parse(raw);
  const mode = String(opts?.mode || "merge");
  if (parsed?.schema !== "tiktok-live-watcher-config") {
    return { ok: false, error: "Invalid config file schema." };
  }
  return mergeConfigBundle(parsed, mode === "replace" ? "replace" : "merge");
});
ipcMain.handle("run-check", async () => {
  await runCheck();
  return lastState;
});
ipcMain.handle("open-overlay", (_e, username) => {
  const settings = getSettings();
  const url = obsReaderUrl(normalizeUsername(username), settings.obsParams);
  return shell.openExternal(url);
});

ipcMain.handle("open-chat-popup", (_e, username) => {
  try {
    const win = openChatPopup(username);
    return { ok: Boolean(win) };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle("open-history-popup", () => {
  try {
    const win = openHistoryPopup();
    return { ok: Boolean(win) };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle("open-settings-popup", () => {
  try {
    const win = openSettingsPopup();
    return { ok: Boolean(win) };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle("open-join-tracker-popup", (_e, hostUsername) => {
  try {
    const win = openJoinTrackerPopup(hostUsername);
    return { ok: Boolean(win) };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
});

ipcMain.handle("get-join-tracker-state", () => ({
  watchUsers: getWatchUsersNormalized(),
  joinEvents,
  trackedHost: joinTrackedHost,
  active: joinTrackerActive,
  cooldownUntil: joinCooldownUntil,
  mode: joinTrackingMode
}));

ipcMain.handle("set-watch-users", (_e, next) => ({ ok: true, watchUsers: saveWatchUsers(next) }));

ipcMain.handle("start-join-tracking", async (_e, hostUsername) => await startJoinTracking(hostUsername));
ipcMain.handle("start-join-tracking-all-live", async () => await startJoinTrackingAllLive());
ipcMain.handle("stop-join-tracking", async () => await stopJoinTracking());

ipcMain.handle("clear-join-events", () => {
  joinEvents = [];
  store.set(JOIN_EVENTS_KEY, joinEvents);
  broadcastJoinTracker();
  return { ok: true };
});

ipcMain.handle("export-join-events-csv", async () => {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: "Export join events (CSV)",
    defaultPath: path.join(appDataDir, "join-events.csv"),
    filters: [{ name: "CSV", extensions: ["csv"] }]
  });
  if (canceled || !filePath) return { ok: false, canceled: true };

  const header = ["ts", "type", "host", "viewer", "error"].join(",");
  const lines = joinEvents
    .slice()
    .reverse()
    .map((h) => {
      const row = [
        new Date(h.ts).toISOString(),
        h.type || "",
        h.host || "",
        h.viewer || "",
        (h.error || "").toString().replace(/\r?\n/g, " ")
      ];
      return row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",");
    });
  const csv = [header, ...lines].join("\n");
  fs.writeFileSync(filePath, csv, "utf8");
  return { ok: true, filePath };
});

ipcMain.handle("choose-sound-file", async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: "Избери sound файл",
    properties: ["openFile"],
    filters: [{ name: "Audio", extensions: ["wav", "mp3", "ogg", "m4a"] }]
  });
  if (canceled || !filePaths?.[0]) return { ok: false, canceled: true };
  return { ok: true, path: filePaths[0] };
});

ipcMain.handle("test-sound", async (_e, payload) => {
  const enabled = Boolean(payload?.enabled);
  if (!enabled) return { ok: true, skipped: true };
  playSoundPayload({
    type: payload?.type,
    customPath: payload?.customPath
  });
  return { ok: true };
});

ipcMain.handle("reload-ui", () => {
  if (!mainWindow) createWindow();
  mainWindow.webContents.reloadIgnoringCache();
  mainWindow.show();
  mainWindow.focus();
  return true;
});

ipcMain.handle("toggle-devtools", () => {
  if (!mainWindow) createWindow();
  if (mainWindow.webContents.isDevToolsOpened()) mainWindow.webContents.closeDevTools();
  else mainWindow.webContents.openDevTools({ mode: "detach" });
  mainWindow.show();
  mainWindow.focus();
  return true;
});

ipcMain.handle("get-app-status", () => getAppStatus());

app.whenReady().then(async () => {
  createWindow();
  createTray();
  scheduleChecks();
  await runCheck();
  await maybeAutoStartJoinTrackingAllLive(getSettings());
  broadcastHistory();
  broadcastNotificationsState();
  broadcastAppStatus();
});

app.on("window-all-closed", (e) => {
  // keep tray app alive
  e.preventDefault();
});

