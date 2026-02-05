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

function formatDateTime(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleString([], {
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

let state = {
  watchUsers: [],
  joinEvents: [],
  trackedHost: null,
  active: false,
  cooldownUntil: 0,
  mode: "single"
};

let draftWatchUsers = [];
let joinSearch = "";
let joinType = "all";

function setupSplitResize() {
  const split = document.getElementById("jtSplit");
  const divider = document.getElementById("jtDivider");
  if (!split || !divider) return;

  const key = "jtSplitLeftPx";
  const saved = Number(localStorage.getItem(key));
  if (Number.isFinite(saved) && saved >= 280 && saved <= 760) {
    split.style.setProperty("--splitLeft", `${saved}px`);
  }

  let dragging = false;
  let startX = 0;
  let startW = 0;

  divider.addEventListener("mousedown", (e) => {
    dragging = true;
    startX = e.clientX;
    startW = split.getBoundingClientRect().width
      ? document.getElementById("jtLeft")?.getBoundingClientRect().width || 420
      : 420;
    document.body.classList.add("resizing");
    e.preventDefault();
  });

  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const w = Math.max(280, Math.min(760, Math.round(startW + dx)));
    split.style.setProperty("--splitLeft", `${w}px`);
  });

  window.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove("resizing");
    const v = split.style.getPropertyValue("--splitLeft");
    const px = Number(String(v).replace("px", "").trim());
    if (Number.isFinite(px)) localStorage.setItem(key, String(px));
  });
}

function setStatus(msg) {
  const el = document.getElementById("status");
  el.textContent = msg || "";
  if (msg) setTimeout(() => (el.textContent = ""), 1600);
}

function renderWatchUsers() {
  const list = document.getElementById("watchUserList");
  list.innerHTML = "";

  if (!draftWatchUsers.length) {
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.textContent = "Няма добавени потребители.";
    list.appendChild(empty);
    return;
  }

  draftWatchUsers.forEach((u, idx) => {
    const row = document.createElement("div");
    row.className = "userItem";
    row.innerHTML = `
      <input type="text" spellcheck="false" value="${u}" data-idx="${idx}" aria-label="watch user ${idx + 1}" />
      <button class="btn" type="button" data-remove="${idx}">Изтрий</button>
    `;
    list.appendChild(row);
  });

  list.querySelectorAll("button[data-remove]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.getAttribute("data-remove"));
      if (!Number.isFinite(idx)) return;
      draftWatchUsers.splice(idx, 1);
      draftWatchUsers = uniqUsernames(draftWatchUsers);
      renderWatchUsers();
    });
  });
}

function renderTrackingState() {
  const el = document.getElementById("trackingState");
  if (!el) return;
  const cooldown =
    state.cooldownUntil && Date.now() < state.cooldownUntil
      ? `Cooldown до ${new Date(state.cooldownUntil).toLocaleTimeString()}`
      : null;

  if (!state.active) {
    el.textContent = `Не следим лайф в момента${cooldown ? ` • ${cooldown}` : ""}`;
    return;
  }

  if (state.mode === "allLive") {
    el.textContent = `Следим всички LIVE (в момента: ${state.trackedHost ? `@${state.trackedHost}` : "—"})${
      cooldown ? ` • ${cooldown}` : ""
    }`;
    return;
  }

  el.textContent = `Следим: @${state.trackedHost || "—"}${cooldown ? ` • ${cooldown}` : ""}`;
}

function renderJoinEvents() {
  const list = document.getElementById("joinEventList");
  list.innerHTML = "";

  const q = joinSearch.trim().toLowerCase();
  const filtered = (state.joinEvents || []).filter((e) => {
    if (joinType !== "all" && e.type !== joinType) return false;
    if (!q) return true;
    const hay = `${e.type || ""} ${e.host || ""} ${e.viewer || ""} ${e.error || ""}`.toLowerCase();
    return hay.includes(q);
  });

  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.textContent = "Няма събития.";
    list.appendChild(empty);
    return;
  }

  for (const e of filtered.slice(0, 500)) {
    const row = document.createElement("div");
    row.className = "historyItem";
    const pillClass =
      e.type === "viewer_joined" ? "live" : e.type === "gift_sent" ? "gift" : "unknown";
    row.innerHTML = `
      <div class="historyTop">
        <div><b>${e.viewer ? `@${e.viewer}` : "—"}</b> <span class="muted">${e.host ? `в @${e.host}` : ""}</span></div>
        <span class="pill ${pillClass}">${e.type}</span>
      </div>
      <div class="historyMeta">${formatDateTime(e.ts)}${e.error ? ` • ${String(e.error).slice(0, 220)}` : ""}</div>
    `;
    list.appendChild(row);
  }
}

function renderAll() {
  renderWatchUsers();
  renderTrackingState();
  renderJoinEvents();
}

async function load() {
  const s = await window.api.getSettings();
  window.__applyTheme?.(s);
  state = await window.api.getJoinTrackerState();
  draftWatchUsers = uniqUsernames(state.watchUsers);
  setupSplitResize();
  renderAll();
}

document.getElementById("addWatchUser").addEventListener("click", () => {
  const input = document.getElementById("newWatchUser");
  const u = normalizeUsername(input.value);
  if (!u) return;
  draftWatchUsers = uniqUsernames([...draftWatchUsers, u]);
  input.value = "";
  renderWatchUsers();
});

document.getElementById("newWatchUser").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    document.getElementById("addWatchUser").click();
  }
});

document.getElementById("saveWatchUsers").addEventListener("click", async () => {
  const inline = Array.from(document.querySelectorAll('#watchUserList input[type="text"]')).map((el) => el.value);
  draftWatchUsers = uniqUsernames(inline);
  const res = await window.api.setWatchUsers(draftWatchUsers);
  state.watchUsers = res?.watchUsers || draftWatchUsers;
  setStatus("Запазено.");
  renderWatchUsers();
});

document.getElementById("startTracking").addEventListener("click", async () => {
  const host = normalizeUsername(document.getElementById("hostInput").value);
  if (!host) return;
  const res = await window.api.startJoinTracking(host);
  if (!res?.ok) setStatus(`Неуспех: ${String(res?.error || "unknown").slice(0, 80)}`);
});

document.getElementById("startAllLive").addEventListener("click", async () => {
  const res = await window.api.startJoinTrackingAllLive();
  if (!res?.ok) setStatus(`Неуспех: ${String(res?.error || "unknown").slice(0, 80)}`);
});

document.getElementById("stopTracking").addEventListener("click", async () => {
  await window.api.stopJoinTracking();
});

document.getElementById("hostInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    document.getElementById("startTracking").click();
  }
});

document.getElementById("joinSearch").addEventListener("input", (e) => {
  joinSearch = String(e.target.value || "");
  renderJoinEvents();
});

document.getElementById("joinType").addEventListener("change", (e) => {
  joinType = String(e.target.value || "all");
  renderJoinEvents();
});

document.getElementById("exportJoinCSV").addEventListener("click", async () => {
  await window.api.exportJoinEventsCSV();
});

document.getElementById("clearJoinEvents").addEventListener("click", async () => {
  await window.api.clearJoinEvents();
});

document.getElementById("reloadUI").addEventListener("click", async () => {
  await window.api.reloadUI();
});

document.getElementById("toggleDevTools").addEventListener("click", async () => {
  await window.api.toggleDevTools();
});

window.api.onJoinTrackerUpdated((payload) => {
  state = payload || state;
  // if watchUsers changed externally, refresh draft
  if (Array.isArray(state.watchUsers)) draftWatchUsers = uniqUsernames(state.watchUsers);
  renderAll();
});

window.api.onSettingsUpdated((_s) => {
  window.__applyTheme?.(_s);
});

load();

