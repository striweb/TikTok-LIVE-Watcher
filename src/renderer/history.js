let history = [];
let historySearch = "";
let historyType = "all";
let daysSearch = "";
let daysSort = "dateDesc";
let selectedDayKey = null;

function typePill(t) {
  if (t === "live_started") return { text: "live_started", cls: "live" };
  if (t === "viewer_joined") return { text: "viewer_joined", cls: "live" };
  if (t === "error") return { text: "error", cls: "unknown" };
  return { text: t || "event", cls: "" };
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function dayKeyLocal(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function formatDayTitle(dayKey) {
  const [y, m, d] = String(dayKey).split("-");
  return `${d}.${m}.${y}`;
}

function formatDateTime(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleString([], {
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function setView(mode) {
  const daysView = document.getElementById("daysView");
  const dayDetailView = document.getElementById("dayDetailView");
  const backBtn = document.getElementById("backToDays");
  const titleEl = document.getElementById("historyTitle");
  const subEl = document.getElementById("historySub");

  if (mode === "day" && selectedDayKey) {
    daysView.hidden = true;
    dayDetailView.hidden = false;
    backBtn.hidden = false;
    titleEl.textContent = `History • ${formatDayTitle(selectedDayKey)}`;
    subEl.textContent = "Events for the selected day";
  } else {
    daysView.hidden = false;
    dayDetailView.hidden = true;
    backBtn.hidden = true;
    titleEl.textContent = "History & Logs";
    subEl.textContent = "By day • last 2000 events";
  }
}

function renderHistory() {
  const listEl = document.getElementById("historyList");
  listEl.innerHTML = "";

  const q = historySearch.trim().toLowerCase();
  const filtered = (history || []).filter((h) => {
    if (selectedDayKey && dayKeyLocal(h.ts) !== selectedDayKey) return false;
    if (historyType !== "all" && h.type !== historyType) return false;
    if (!q) return true;
    const hay = `${h.type || ""} ${h.username || ""} ${h.reason || ""} ${h.error || ""}`.toLowerCase();
    return hay.includes(q);
  });

  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.textContent = "No entries to display.";
    listEl.appendChild(empty);
    return;
  }

  for (const h of filtered.slice(0, 500)) {
    const tp = typePill(h.type);
    const row = document.createElement("div");
    row.className = "historyItem";
    row.innerHTML = `
      <div class="historyTop">
        <div><b>${h.username ? `@${h.username}` : "—"}</b></div>
        <span class="pill ${tp.cls}">${tp.text}</span>
      </div>
      <div class="historyMeta">${formatDateTime(h.ts)}${h.roomId ? ` • roomId ${h.roomId}` : ""}${
        h.reason ? ` • ${h.reason}` : ""
      }${h.error ? ` • ${String(h.error).slice(0, 220)}` : ""}</div>
    `;
    listEl.appendChild(row);
  }
}

function renderDays() {
  const grid = document.getElementById("daysGrid");
  grid.innerHTML = "";

  const byDay = new Map();
  for (const h of history || []) {
    const dk = dayKeyLocal(h.ts);
    const cur =
      byDay.get(dk) || {
        dayKey: dk,
        total: 0,
        errors: 0,
        liveStarted: 0,
        liveEnded: 0
      };
    cur.total += 1;
    if (h.type === "error") cur.errors += 1;
    if (h.type === "live_started") cur.liveStarted += 1;
    if (h.type === "live_ended") cur.liveEnded += 1;
    byDay.set(dk, cur);
  }

  let days = Array.from(byDay.values());

  const q = daysSearch.trim().toLowerCase();
  if (q) {
    days = days.filter((d) => formatDayTitle(d.dayKey).toLowerCase().includes(q) || d.dayKey.includes(q));
  }

  const sorters = {
    dateDesc: (a, b) => (a.dayKey < b.dayKey ? 1 : a.dayKey > b.dayKey ? -1 : 0),
    errorsDesc: (a, b) => b.errors - a.errors || b.total - a.total,
    eventsDesc: (a, b) => b.total - a.total || b.errors - a.errors
  };
  days.sort(sorters[daysSort] || sorters.dateDesc);

  if (!days.length) {
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.textContent = "No days to display.";
    grid.appendChild(empty);
    return;
  }

  for (const d of days) {
    const card = document.createElement("div");
    card.className = "dayCard";
    card.setAttribute("role", "button");
    card.tabIndex = 0;
    card.innerHTML = `
      <div class="dayTitle">${formatDayTitle(d.dayKey)}</div>
      <div class="dayMeta">
        <span class="kpi">${d.total} events</span>
        <span class="kpi ok">${d.liveStarted} live_start</span>
        <span class="kpi">${d.liveEnded} live_end</span>
        <span class="kpi err">${d.errors} errors</span>
      </div>
    `;

    const open = () => {
      selectedDayKey = d.dayKey;
      setView("day");
      renderHistory();
    };
    card.addEventListener("click", open);
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open();
      }
    });
    grid.appendChild(card);
  }
}

async function load() {
  const s = await window.api.getSettings();
  window.__applyTheme?.(s);
  history = await window.api.getHistory();
  setView("days");
  renderDays();
  renderHistory();
}

document.getElementById("exportHistory").addEventListener("click", async () => {
  await window.api.exportHistoryCSV();
});

document.getElementById("clearHistory").addEventListener("click", async () => {
  await window.api.clearHistory();
});

document.getElementById("reloadUI").addEventListener("click", async () => {
  await window.api.reloadUI();
});

document.getElementById("toggleDevTools").addEventListener("click", async () => {
  await window.api.toggleDevTools();
});

document.getElementById("historySearch").addEventListener("input", (e) => {
  historySearch = String(e.target.value || "");
  renderHistory();
});

document.getElementById("historyType").addEventListener("change", (e) => {
  historyType = String(e.target.value || "all");
  renderHistory();
});

document.getElementById("daysSearch").addEventListener("input", (e) => {
  daysSearch = String(e.target.value || "");
  renderDays();
});

document.getElementById("daysSort").addEventListener("change", (e) => {
  daysSort = String(e.target.value || "dateDesc");
  renderDays();
});

document.getElementById("backToDays").addEventListener("click", () => {
  selectedDayKey = null;
  historySearch = "";
  historyType = "all";
  document.getElementById("historySearch").value = "";
  document.getElementById("historyType").value = "all";
  setView("days");
  renderDays();
});

window.api.onHistoryUpdated((h) => {
  history = Array.isArray(h) ? h : [];
  renderDays();
  renderHistory();
});

window.api.onSettingsUpdated((s) => {
  window.__applyTheme?.(s);
});

load();

