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
let analyticsViewer = "";
let analyticsCharts = {};

function destroyAnalyticsCharts() {
  for (const c of Object.values(analyticsCharts || {})) {
    try {
      c?.destroy?.();
    } catch {}
  }
  analyticsCharts = {};
}

function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function lastNDaysKeys(n) {
  const out = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
  }
  return out;
}

function parseGiftUnits(summary) {
  const s = String(summary || "");
  const m = s.match(/\bx(\d+)\b/i);
  const n = m ? Number(m[1]) : 1;
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function cssVar(name, fallback = "") {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch {
    return fallback;
  }
}

function makeBarChart(canvas, { title, labels, data, color }) {
  if (!canvas || !window.Chart) return null;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

  return new window.Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: title,
          data,
          backgroundColor: color,
          borderRadius: 4,
          borderSkipped: false,
          maxBarThickness: 18
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: reduce ? false : { duration: 260, easing: "easeOutCubic" },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: true,
          backgroundColor: cssVar("--panel", "rgba(20,20,28,0.94)"),
          borderColor: cssVar("--border", "rgba(255,255,255,0.12)"),
          borderWidth: 1,
          titleColor: cssVar("--text", "rgba(232,233,239,0.92)"),
          bodyColor: cssVar("--text", "rgba(232,233,239,0.92)"),
          displayColors: false,
          callbacks: {
            title: (items) => items?.[0]?.label || "",
            label: (ctx2) => `${ctx2.dataset.label}: ${ctx2.raw ?? 0}`
          }
        }
      },
      scales: {
        x: { display: false, grid: { display: false } },
        y: { display: false, grid: { display: false }, beginAtZero: true }
      }
    }
  });
}

function computeViewerAnalytics(viewer, days = 14) {
  const v = normalizeUsername(viewer);
  const keys = lastNDaysKeys(days);
  const joinsByDay = new Map(keys.map((k) => [k, 0]));
  const giftsByDay = new Map(keys.map((k) => [k, 0]));
  const giftUnitsByDay = new Map(keys.map((k) => [k, 0]));
  const hosts = new Map(); // host -> { joins, gifts, giftUnits, lastTs }

  for (const e of state.joinEvents || []) {
    if (!e?.ts) continue;
    const evViewer = normalizeUsername(e.viewer || "");
    if (!v || evViewer !== v) continue;
    const host = normalizeUsername(e.host || "");
    const dk = dayKey(e.ts);
    if (e.type === "viewer_joined") {
      if (joinsByDay.has(dk)) joinsByDay.set(dk, (joinsByDay.get(dk) || 0) + 1);
      if (host) {
        const cur = hosts.get(host) || { joins: 0, gifts: 0, giftUnits: 0, lastTs: 0 };
        cur.joins += 1;
        cur.lastTs = Math.max(cur.lastTs, e.ts || 0);
        hosts.set(host, cur);
      }
    }
    if (e.type === "gift_sent") {
      const units = parseGiftUnits(e.error);
      if (giftsByDay.has(dk)) giftsByDay.set(dk, (giftsByDay.get(dk) || 0) + 1);
      if (giftUnitsByDay.has(dk)) giftUnitsByDay.set(dk, (giftUnitsByDay.get(dk) || 0) + units);
      if (host) {
        const cur = hosts.get(host) || { joins: 0, gifts: 0, giftUnits: 0, lastTs: 0 };
        cur.gifts += 1;
        cur.giftUnits += units;
        cur.lastTs = Math.max(cur.lastTs, e.ts || 0);
        hosts.set(host, cur);
      }
    }
  }

  const joins = keys.map((k) => joinsByDay.get(k) || 0);
  const gifts = keys.map((k) => giftsByDay.get(k) || 0);
  const giftUnits = keys.map((k) => giftUnitsByDay.get(k) || 0);
  const hostRows = Array.from(hosts.entries()).map(([host, v2]) => ({ host, ...v2 }));
  hostRows.sort((a, b) => b.joins + b.gifts - (a.joins + a.gifts) || b.lastTs - a.lastTs || a.host.localeCompare(b.host));

  return { keys, joins, gifts, giftUnits, hostRows };
}

function renderViewerAnalytics() {
  const sel = document.getElementById("analyticsViewer");
  const body = document.getElementById("viewerAnalyticsBody");
  if (!sel || !body) return;

  const viewers = uniqUsernames(state.watchUsers || draftWatchUsers || []);
  if (!analyticsViewer || !viewers.includes(analyticsViewer)) {
    analyticsViewer = viewers[0] || "";
  }

  sel.innerHTML = viewers.length
    ? viewers.map((v) => `<option value="${v}">@${v}</option>`).join("")
    : `<option value="">(no watched viewers)</option>`;
  sel.value = analyticsViewer || "";

  destroyAnalyticsCharts();

  if (!analyticsViewer) {
    body.innerHTML = `
      <div class="emptyState">
        <div class="emptyTitle">No watched viewers</div>
        <div class="emptySub">Add watched viewers on the left to see analytics.</div>
      </div>
    `;
    return;
  }

  const a = computeViewerAnalytics(analyticsViewer, 14);
  const sumJoins = a.joins.reduce((x, y) => x + y, 0);
  const sumGifts = a.gifts.reduce((x, y) => x + y, 0);
  const sumGiftUnits = a.giftUnits.reduce((x, y) => x + y, 0);
  const topHosts = a.hostRows.slice(0, 8);

  body.innerHTML = `
    <div class="charts">
      <div class="chartRow">
        <div class="chartTop">
          <div class="chartTitle">Joins (last 14 days)</div>
          <div class="chartTotal">Total: ${sumJoins}</div>
        </div>
        <div class="chartCanvasWrap"><canvas class="chartCanvas" id="vaJoins"></canvas></div>
      </div>
      <div class="chartRow">
        <div class="chartTop">
          <div class="chartTitle">Gifts (last 14 days)</div>
          <div class="chartTotal">Events: ${sumGifts}${sumGiftUnits !== sumGifts ? ` • Units: ${sumGiftUnits}` : ""}</div>
        </div>
        <div class="chartCanvasWrap"><canvas class="chartCanvas" id="vaGifts"></canvas></div>
      </div>
    </div>

    <div class="h3" style="margin-top:12px;">Top hosts</div>
    <div class="muted" style="margin-top:2px;">Where this viewer appeared most often.</div>
    <div class="analyticsHosts" id="vaHosts"></div>
  `;

  const joinColor = cssVar("--accent2", "rgba(99,102,241,0.55)");
  analyticsCharts.joins = makeBarChart(document.getElementById("vaJoins"), {
    title: "Joins",
    labels: a.keys,
    data: a.joins,
    color: joinColor
  });
  analyticsCharts.gifts = makeBarChart(document.getElementById("vaGifts"), {
    title: "Gift events",
    labels: a.keys,
    data: a.gifts,
    color: "rgba(239, 68, 68, 0.50)"
  });

  const hostEl = document.getElementById("vaHosts");
  if (!hostEl) return;
  if (!topHosts.length) {
    hostEl.innerHTML = `
      <div class="emptyState">
        <div class="emptyTitle">No events yet</div>
        <div class="emptySub">Once this viewer joins or sends gifts, hosts will appear here.</div>
      </div>
    `;
    return;
  }

  hostEl.innerHTML = topHosts
    .map((h) => {
      const last = h.lastTs ? new Date(h.lastTs).toLocaleString() : "—";
      return `
        <div class="analyticsHostRow">
          <div>
            <div><b>@${h.host}</b></div>
            <div class="analyticsHostMeta">
              <span>Joins: <span class="analyticsKpi">${h.joins}</span></span>
              <span>Gifts: <span class="analyticsKpi">${h.gifts}</span></span>
              <span>Units: <span class="analyticsKpi">${h.giftUnits}</span></span>
              <span>Last: <span class="analyticsKpi">${last}</span></span>
            </div>
          </div>
          <div>
            <button class="btn ghost" type="button" data-open-chat="${h.host}">Chat</button>
          </div>
        </div>
      `;
    })
    .join("");

  hostEl.querySelectorAll("button[data-open-chat]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const host = btn.getAttribute("data-open-chat");
      if (!host) return;
      await window.api.openChatPopup(host);
    });
  });
}

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
    empty.textContent = "No users added.";
    list.appendChild(empty);
    return;
  }

  draftWatchUsers.forEach((u, idx) => {
    const row = document.createElement("div");
    row.className = "userItem";
    row.innerHTML = `
      <input type="text" spellcheck="false" value="${u}" data-idx="${idx}" aria-label="watch user ${idx + 1}" />
      <button class="btn" type="button" data-remove="${idx}">Delete</button>
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
      ? `Cooldown until ${new Date(state.cooldownUntil).toLocaleTimeString()}`
      : null;

  if (!state.active) {
    el.textContent = `Not tracking a live right now${cooldown ? ` • ${cooldown}` : ""}`;
    return;
  }

  if (state.mode === "allLive") {
    el.textContent = `Tracking all LIVE (current: ${state.trackedHost ? `@${state.trackedHost}` : "—"})${
      cooldown ? ` • ${cooldown}` : ""
    }`;
    return;
  }

  el.textContent = `Tracking: @${state.trackedHost || "—"}${cooldown ? ` • ${cooldown}` : ""}`;
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
    empty.textContent = "No events.";
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
        <div><b>${e.viewer ? `@${e.viewer}` : "—"}</b> <span class="muted">${e.host ? `in @${e.host}` : ""}</span></div>
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
  renderViewerAnalytics();
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
  setStatus("Saved.");
  renderWatchUsers();
  renderViewerAnalytics();
});

document.getElementById("startTracking").addEventListener("click", async () => {
  const host = normalizeUsername(document.getElementById("hostInput").value);
  if (!host) return;
  const res = await window.api.startJoinTracking(host);
  if (!res?.ok) setStatus(`Failed: ${String(res?.error || "unknown").slice(0, 80)}`);
});

document.getElementById("startAllLive").addEventListener("click", async () => {
  const res = await window.api.startJoinTrackingAllLive();
  if (!res?.ok) setStatus(`Failed: ${String(res?.error || "unknown").slice(0, 80)}`);
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
  if (Array.isArray(state.watchUsers)) draftWatchUsers = uniqUsernames(state.watchUsers);
  renderAll();
});

document.getElementById("analyticsViewer")?.addEventListener("change", (e) => {
  analyticsViewer = normalizeUsername(e.target.value);
  renderViewerAnalytics();
});

window.api.onSettingsUpdated((_s) => {
  window.__applyTheme?.(_s);
});

load();

