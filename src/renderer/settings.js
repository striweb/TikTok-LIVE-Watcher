const DEFAULTS = {
  usernames: [],
  intervalMinutes: 1,
  perHostIntervals: {},
  joinNotify: true,
  joinNotifyCooldownMinutes: 10,
  autoTrackAllLive: true,
  giftTrack: true,
  giftNotify: true,
  giftNotifyCooldownSeconds: 60,
  soundEnabled: true,
  soundType: "chime",
  soundCustomPath: "",
  themeMode: "system",
  darkVariant: "midnight",
  themePack: "default",
  uiEngine: "legacy",
  accent: "violet",
  density: "comfortable",
  dashboardView: "kanban",
  dashboardLayout: "default",
  obsParams:
    "showLikes=1&showChats=1&showGifts=1&showFollows=1&showJoins=1&bgColor=rgb(24,23,28)&fontColor=rgb(227,229,235)&fontSize=1.3em"
};

function clampIntervalMinutes(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return DEFAULTS.intervalMinutes;
  return Math.max(1, Math.min(60, Math.round(num)));
}

function clampJoinNotifyCooldownMinutes(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return DEFAULTS.joinNotifyCooldownMinutes;
  return Math.max(0, Math.min(180, Math.round(num)));
}

function clampGiftNotifyCooldownSeconds(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return DEFAULTS.giftNotifyCooldownSeconds;
  return Math.max(0, Math.min(3600, Math.round(num)));
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

function normalizeDarkVariant(v) {
  const t = String(v || "").trim();
  if (t === "midnight" || t === "graphite" || t === "amoled" || t === "indigo") return t;
  return DEFAULTS.darkVariant;
}

function normalizeThemePack(v) {
  const t = String(v || "").trim();
  if (t === "default" || t === "ops" || t === "streamer" || t === "minimal" || t === "neon" || t === "midnightPro") return t;
  return DEFAULTS.themePack;
}

function normalizeUiEngine(v) {
  const t = String(v || "").trim();
  if (t === "legacy" || t === "react") return t;
  return DEFAULTS.uiEngine;
}

function normalizeAccent(v) {
  const a = String(v || "").trim();
  if (["violet", "blue", "teal", "green", "amber", "red"].includes(a)) return a;
  return DEFAULTS.accent;
}

function normalizeDensity(v) {
  const d = String(v || "").trim();
  if (d === "comfortable" || d === "compact" || d === "ultra") return d;
  return DEFAULTS.density;
}

function normalizeDashboardView(v) {
  const t = String(v || "").trim();
  if (t === "table" || t === "kanban") return t;
  return DEFAULTS.dashboardView;
}

function normalizeDashboardLayout(v) {
  const t = String(v || "").trim();
  if (t === "default" || t === "cards" || t === "ops") return t;
  return DEFAULTS.dashboardLayout;
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

let settings = { ...DEFAULTS };
let usernamesState = [];
let perHostIntervalsState = {};

const THEME_PRESETS = {
  enterpriseDark: { themeMode: "dark", darkVariant: "midnight", accent: "violet", density: "comfortable" },
  neon: { themeMode: "dark", darkVariant: "amoled", accent: "teal", density: "compact" },
  lightClean: { themeMode: "light", accent: "blue", density: "comfortable" },
  midnightTeal: { themeMode: "dark", darkVariant: "midnight", accent: "teal", density: "comfortable", dashboardView: "kanban" },
  graphiteBlue: { themeMode: "dark", darkVariant: "graphite", accent: "blue", density: "comfortable", dashboardView: "table" },
  emeraldGlass: { themeMode: "dark", darkVariant: "graphite", accent: "green", density: "comfortable", dashboardView: "kanban" },
  amberOps: { themeMode: "dark", darkVariant: "indigo", accent: "amber", density: "compact", dashboardView: "table" },
  rubyAlert: { themeMode: "dark", darkVariant: "amoled", accent: "red", density: "compact", dashboardView: "table" },
  iceLight: { themeMode: "light", accent: "teal", density: "comfortable", dashboardView: "table" },
  paperLight: { themeMode: "light", accent: "amber", density: "comfortable", dashboardView: "table" }
};

function setStatus(msg) {
  const els = [document.getElementById("status"), document.getElementById("statusSettings")].filter(Boolean);
  els.forEach((el) => {
    el.textContent = msg || "";
  });
  if (msg) {
    setTimeout(() => {
      els.forEach((el) => {
        el.textContent = "";
      });
    }, 1600);
  }
}

function renderUserList() {
  const list = document.getElementById("userList");
  list.innerHTML = "";

  if (!usernamesState.length) {
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.textContent = "No profiles added.";
    list.appendChild(empty);
    return;
  }

  usernamesState.forEach((u, idx) => {
    const row = document.createElement("div");
    row.className = "userItem";
    const globalMin = clampIntervalMinutes(settings.intervalMinutes);
    const per = perHostIntervalsState[u] ?? globalMin;
    row.innerHTML = `
      <input type="text" spellcheck="false" value="${u}" data-idx="${idx}" aria-label="username ${idx + 1}" />
      <input type="number" min="1" max="60" step="1" value="${per}" placeholder="${globalMin}" data-per-idx="${idx}" aria-label="per host minutes ${idx + 1}" style="max-width:120px;" />
      <button class="btn" type="button" data-remove="${idx}">Delete</button>
    `;
    list.appendChild(row);
  });

  list.querySelectorAll("button[data-remove]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.getAttribute("data-remove"));
      if (!Number.isFinite(idx)) return;
      usernamesState.splice(idx, 1);
      usernamesState = uniqUsernames(usernamesState);
      renderUserList();
    });
  });
}

async function load() {
  settings = { ...DEFAULTS, ...(await window.api.getSettings()) };
  window.__applyTheme?.(settings);
  usernamesState = uniqUsernames(settings.usernames);
  perHostIntervalsState = settings.perHostIntervals && typeof settings.perHostIntervals === "object" ? settings.perHostIntervals : {};
  renderUserList();

  document.getElementById("intervalMinutes").value = String(clampIntervalMinutes(settings.intervalMinutes));
  document.getElementById("joinNotify").checked = Boolean(settings.joinNotify);
  document.getElementById("joinNotifyCooldownMinutes").value = String(
    clampJoinNotifyCooldownMinutes(settings.joinNotifyCooldownMinutes)
  );
  document.getElementById("autoTrackAllLive").checked = Boolean(settings.autoTrackAllLive);
  document.getElementById("giftTrack").checked = Boolean(settings.giftTrack);
  document.getElementById("giftNotify").checked = Boolean(settings.giftNotify);
  document.getElementById("giftNotifyCooldownSeconds").value = String(
    clampGiftNotifyCooldownSeconds(settings.giftNotifyCooldownSeconds)
  );
  document.getElementById("soundEnabled").checked = Boolean(settings.soundEnabled);
  document.getElementById("soundType").value = normalizeSoundType(settings.soundType);
  document.getElementById("soundCustomPath").value = String(settings.soundCustomPath || "");
  document.getElementById("themeMode").value = normalizeThemeMode(settings.themeMode);
  document.getElementById("darkVariant").value = normalizeDarkVariant(settings.darkVariant);
  document.getElementById("themePack").value = normalizeThemePack(settings.themePack);
  document.getElementById("uiEngine").value = normalizeUiEngine(settings.uiEngine);
  document.getElementById("accent").value = normalizeAccent(settings.accent);
  document.getElementById("density").value = normalizeDensity(settings.density);
  document.getElementById("dashboardView").value = normalizeDashboardView(settings.dashboardView);
  document.getElementById("dashboardLayout").value = normalizeDashboardLayout(settings.dashboardLayout);
  document.getElementById("themePreset").value = "";
}

async function save() {
  const inline = Array.from(document.querySelectorAll('#userList input[type="text"]')).map((el) => el.value);
  usernamesState = uniqUsernames(inline);
  const perInline = Array.from(document.querySelectorAll('#userList input[data-per-idx]')).map((el) => el.value);
  const perMap = {};
  const globalMin = clampIntervalMinutes(document.getElementById("intervalMinutes").value);
  usernamesState.forEach((u, idx) => {
    const raw = String(perInline[idx] ?? "").trim();
    if (!raw) return;
    const v = Math.round(Number(raw));
    if (!Number.isFinite(v) || v < 1 || v > 60) return;
    if (v !== globalMin) perMap[u] = v;
  });
  perHostIntervalsState = perMap;
  renderUserList();

  const next = {
    usernames: usernamesState,
    intervalMinutes: clampIntervalMinutes(document.getElementById("intervalMinutes").value),
    perHostIntervals: perHostIntervalsState,
    joinNotify: Boolean(document.getElementById("joinNotify").checked),
    joinNotifyCooldownMinutes: clampJoinNotifyCooldownMinutes(document.getElementById("joinNotifyCooldownMinutes").value),
    autoTrackAllLive: Boolean(document.getElementById("autoTrackAllLive").checked),
    giftTrack: Boolean(document.getElementById("giftTrack").checked),
    giftNotify: Boolean(document.getElementById("giftNotify").checked),
    giftNotifyCooldownSeconds: clampGiftNotifyCooldownSeconds(document.getElementById("giftNotifyCooldownSeconds").value),
    soundEnabled: Boolean(document.getElementById("soundEnabled").checked),
    soundType: normalizeSoundType(document.getElementById("soundType").value),
    soundCustomPath: String(document.getElementById("soundCustomPath").value || ""),
    themeMode: normalizeThemeMode(document.getElementById("themeMode").value),
    darkVariant: normalizeDarkVariant(document.getElementById("darkVariant").value),
    themePack: normalizeThemePack(document.getElementById("themePack").value),
    uiEngine: normalizeUiEngine(document.getElementById("uiEngine").value),
    accent: normalizeAccent(document.getElementById("accent").value),
    density: normalizeDensity(document.getElementById("density").value),
    dashboardView: normalizeDashboardView(document.getElementById("dashboardView").value),
    dashboardLayout: normalizeDashboardLayout(document.getElementById("dashboardLayout").value),
    obsParams: settings.obsParams
  };
  settings = await window.api.setSettings(next);
  setStatus("Saved.");
}

async function reset() {
  settings = await window.api.setSettings(DEFAULTS);
  await load();
  setStatus("Reset.");
}

document.getElementById("addUsername").addEventListener("click", () => {
  const input = document.getElementById("newUsername");
  const u = normalizeUsername(input.value);
  if (!u) return;
  usernamesState = uniqUsernames([...usernamesState, u]);
  input.value = "";
  renderUserList();
});

document.getElementById("newUsername").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    document.getElementById("addUsername").click();
  }
});

document.getElementById("save").addEventListener("click", () => void save());
document.getElementById("saveSettings").addEventListener("click", () => void save());
document.getElementById("reset").addEventListener("click", () => void reset());

document.getElementById("reloadUI").addEventListener("click", async () => {
  await window.api.reloadUI();
});

document.getElementById("toggleDevTools").addEventListener("click", async () => {
  await window.api.toggleDevTools();
});

document.getElementById("browseSound").addEventListener("click", async () => {
  const res = await window.api.chooseSoundFile();
  if (res?.ok && res?.path) {
    document.getElementById("soundCustomPath").value = String(res.path);
    document.getElementById("soundType").value = "custom";
  }
});

document.getElementById("testSound").addEventListener("click", async () => {
  const enabled = Boolean(document.getElementById("soundEnabled").checked);
  const type = normalizeSoundType(document.getElementById("soundType").value);
  const customPath = String(document.getElementById("soundCustomPath").value || "");
  await window.api.testSound({ enabled, type, customPath });
});

document.getElementById("applyPreset").addEventListener("click", async () => {
  const key = String(document.getElementById("themePreset").value || "");
  if (!key) return;
  const preset = THEME_PRESETS[key];
  if (!preset) return;

  document.getElementById("themeMode").value = preset.themeMode;
  if (preset.darkVariant) document.getElementById("darkVariant").value = preset.darkVariant;
  document.getElementById("accent").value = preset.accent;
  document.getElementById("density").value = preset.density;
  if (preset.dashboardView) document.getElementById("dashboardView").value = preset.dashboardView;

  await save();
  setStatus("Preset applied.");
});

document.getElementById("restartApp").addEventListener("click", async () => {
  await window.api.restartApp({ clearCache: false });
});

document.getElementById("clearCacheRestart").addEventListener("click", async () => {
  if (!confirm("Clear cache and restart the app?")) return;
  await window.api.restartApp({ clearCache: true });
});

document.getElementById("clearCache").addEventListener("click", async () => {
  const res = await window.api.clearCache();
  if (res?.ok) setStatus("Cache cleared.");
  else setStatus("Could not clear cache.");
});

document.getElementById("exportConfig").addEventListener("click", async () => {
  const res = await window.api.exportConfigJSON();
  if (res?.ok) setStatus("Export OK.");
  else if (!res?.canceled) setStatus(`Export error: ${String(res?.error || "unknown").slice(0, 80)}`);
});

document.getElementById("importConfig").addEventListener("click", async () => {
  const mode = String(document.getElementById("importMode").value || "merge");
  if (mode === "replace") {
    const ok = confirm("Replace will overwrite settings and lists. Are you sure?");
    if (!ok) return;
  }
  const res = await window.api.importConfigJSON({ mode });
  if (res?.ok) {
    setStatus("Import OK.");
  } else if (!res?.canceled) {
    setStatus(`Import error: ${String(res?.error || "unknown").slice(0, 120)}`);
  }
});

document.getElementById("factoryReset").addEventListener("click", async () => {
  const ok1 = confirm(
    "Factory reset will delete profiles, settings, history, join tracker lists and unread state.\n\nContinue?"
  );
  if (!ok1) return;
  const code = prompt("Type RESET to confirm:");
  if (String(code || "").trim().toUpperCase() !== "RESET") {
    setStatus("Cancelled.");
    return;
  }
  await window.api.factoryReset();
});

window.api.onSettingsUpdated((s) => {
  settings = { ...DEFAULTS, ...(s || {}) };
  window.__applyTheme?.(settings);
  usernamesState = uniqUsernames(settings.usernames);
  perHostIntervalsState = settings.perHostIntervals && typeof settings.perHostIntervals === "object" ? settings.perHostIntervals : {};
  renderUserList();
  document.getElementById("intervalMinutes").value = String(clampIntervalMinutes(settings.intervalMinutes));
  document.getElementById("joinNotify").checked = Boolean(settings.joinNotify);
  document.getElementById("joinNotifyCooldownMinutes").value = String(
    clampJoinNotifyCooldownMinutes(settings.joinNotifyCooldownMinutes)
  );
  document.getElementById("autoTrackAllLive").checked = Boolean(settings.autoTrackAllLive);
  document.getElementById("giftTrack").checked = Boolean(settings.giftTrack);
  document.getElementById("giftNotify").checked = Boolean(settings.giftNotify);
  document.getElementById("giftNotifyCooldownSeconds").value = String(
    clampGiftNotifyCooldownSeconds(settings.giftNotifyCooldownSeconds)
  );
  document.getElementById("soundEnabled").checked = Boolean(settings.soundEnabled);
  document.getElementById("soundType").value = normalizeSoundType(settings.soundType);
  document.getElementById("soundCustomPath").value = String(settings.soundCustomPath || "");
  document.getElementById("themeMode").value = normalizeThemeMode(settings.themeMode);
  document.getElementById("darkVariant").value = normalizeDarkVariant(settings.darkVariant);
  document.getElementById("themePack").value = normalizeThemePack(settings.themePack);
  document.getElementById("uiEngine").value = normalizeUiEngine(settings.uiEngine);
  document.getElementById("accent").value = normalizeAccent(settings.accent);
  document.getElementById("density").value = normalizeDensity(settings.density);
  document.getElementById("dashboardView").value = normalizeDashboardView(settings.dashboardView);
  document.getElementById("dashboardLayout").value = normalizeDashboardLayout(settings.dashboardLayout);
  document.getElementById("themePreset").value = "";
});

load();

