const DEFAULTS = {
  usernames: ["kkstefanov", "ianaki82", "oceanclient1"],
  intervalMinutes: 1,
  obsParams:
    "showLikes=1&showChats=1&showGifts=1&showFollows=1&showJoins=1&bgColor=rgb(24,23,28)&fontColor=rgb(227,229,235)&fontSize=1.3em"
};

function clampIntervalMinutes(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return DEFAULTS.intervalMinutes;
  return Math.max(1, Math.min(60, Math.round(num)));
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

function hashHue(str) {
  let h = 0;
  const s = String(str || "");
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

function avatarStyle(username) {
  const hue = hashHue(username);
  return `--av: linear-gradient(135deg, hsla(${hue}, 85%, 60%, 0.95), hsla(${(hue + 38) % 360}, 85%, 58%, 0.85));`;
}

function avatarLetter(username) {
  const u = String(username || "").trim().replace(/^@+/, "");
  return (u[0] || "?").toUpperCase();
}

let settings = { ...DEFAULTS };
let state = { byUser: {} };
let usernamesState = [];
let statusSearch = "";
let statusSort = "liveFirst";
let statusFilter = "all";
let appStatus = null;
let notifications = [];
let notifLastReadAt = 0;
let historyAll = [];
let notifyTab = "all";
let watchUsersState = [];
let joinTrackerState = null;

const PINNED_KEY = "pinnedProfilesV1";
const FOCUS_KEY = "focusModeV1";

function readJsonLS(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const v = JSON.parse(raw);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJsonLS(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function pinnedSet() {
  const arr = readJsonLS(PINNED_KEY, []);
  return new Set(Array.isArray(arr) ? arr.map(normalizeUsername).filter(Boolean) : []);
}

function togglePinned(u) {
  const set = pinnedSet();
  const key = normalizeUsername(u);
  if (!key) return;
  if (set.has(key)) set.delete(key);
  else set.add(key);
  writeJsonLS(PINNED_KEY, Array.from(set));
}

function toast(msg, kind = "ok") {
  const wrap = document.getElementById("toastCenter");
  if (!wrap) return;
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = String(msg || "");
  wrap.appendChild(el);
  setTimeout(() => el.classList.add("show"), 10);
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 220);
  }, 2200);
}

function isFocusMode() {
  return Boolean(readJsonLS(FOCUS_KEY, false));
}

function applyFocusMode(v) {
  writeJsonLS(FOCUS_KEY, Boolean(v));
  document.documentElement.dataset.focus = v ? "1" : "0";
}

const DASH_COLLAPSE_KEY = "dashCollapsedV1";

function readDashCollapsed() {
  try {
    const raw = localStorage.getItem(DASH_COLLAPSE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeDashCollapsed(map) {
  try {
    localStorage.setItem(DASH_COLLAPSE_KEY, JSON.stringify(map || {}));
  } catch {}
}

function applyCollapsed(cardId, collapsed) {
  const card = document.getElementById(cardId);
  if (!card) return;
  card.classList.toggle("isCollapsed", Boolean(collapsed));
  const btn = card.querySelector(`.collapseBtn[data-collapse="${cardId}"]`);
  if (btn) btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
}

function initDashCollapsibles() {
  const ids = ["activityCard", "giftsCard", "chartsCard", "healthCard"];
  const map = readDashCollapsed();
  ids.forEach((id) => applyCollapsed(id, Boolean(map[id])));

  document.querySelectorAll(".collapseBtn[data-collapse]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-collapse");
      if (!id) return;
      const cur = readDashCollapsed();
      const next = !Boolean(cur[id]);
      cur[id] = next;
      writeDashCollapsed(cur);
      applyCollapsed(id, next);

      if (!next && id === "chartsCard") {
        renderCharts();
      }
    });
  });
}

const NOTIFY_TYPES = new Set(["live_started", "viewer_joined", "gift_sent", "rate_limited"]);
const seenNotifIds = new Set();

const kanbanCardByUser = new Map();
const lastKanbanBucketByUser = new Map();

function prefersReducedMotion() {
  try {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function animateNumberText(el, to) {
  if (!el) return;
  const reduce = prefersReducedMotion();
  const target = Number(to);
  if (!Number.isFinite(target)) {
    el.textContent = String(to);
    return;
  }
  if (reduce) {
    el.textContent = String(target);
    return;
  }
  const from = Number(el.dataset.num ?? el.textContent ?? 0);
  const start = Number.isFinite(from) ? from : 0;
  if (start === target) return;
  const dur = 220;
  const t0 = performance.now();
  el.dataset.num = String(target);
  const tick = (t) => {
    const p = Math.min(1, (t - t0) / dur);
    const e = 1 - Math.pow(1 - p, 3);
    const v = Math.round(start + (target - start) * e);
    el.textContent = String(v);
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function bucketKeyFor(st) {
  if (st?.isLive === true) return "live";
  if (st?.isLive === false) return "offline";
  return "unknown";
}

function ensureKanbanSkeleton(listEl) {
  let wrap = listEl.querySelector(".kanban");
  if (wrap) return wrap;
  listEl.innerHTML = "";
  wrap = document.createElement("div");
  wrap.className = "kanban";
  wrap.innerHTML = `
    <div class="kanbanCol" data-col="live">
      <div class="kanbanHead">
        <div class="kanbanTitle">LIVE</div>
        <span class="chip" data-count="live">0</span>
      </div>
      <div class="kanbanList" data-list="live"><div class="kanbanEmpty muted">—</div></div>
    </div>
    <div class="kanbanCol" data-col="offline">
      <div class="kanbanHead">
        <div class="kanbanTitle">Offline</div>
        <span class="chip" data-count="offline">0</span>
      </div>
      <div class="kanbanList" data-list="offline"><div class="kanbanEmpty muted">—</div></div>
    </div>
    <div class="kanbanCol" data-col="unknown">
      <div class="kanbanHead">
        <div class="kanbanTitle">Unknown</div>
        <span class="chip chipWarn" data-count="unknown">0</span>
      </div>
      <div class="kanbanList" data-list="unknown"><div class="kanbanEmpty muted">—</div></div>
    </div>
  `;
  listEl.appendChild(wrap);
  return wrap;
}

function flashKanbanColumn(wrap, key) {
  const col = wrap.querySelector(`.kanbanCol[data-col="${key}"]`);
  if (!col) return;
  col.classList.remove("flash");
  void col.offsetHeight;
  col.classList.add("flash");
  setTimeout(() => col.classList.remove("flash"), 260);
}

function updateKanbanCard(card, st) {
  const p = pill(st.isLive);
  card.classList.add("kanbanCard");
  card.classList.toggle("liveCard", st?.isLive === true);
  card.classList.toggle("sev-live", st?.isLive === true);
  card.classList.toggle("sev-offline", st?.isLive === false);
  card.classList.toggle("sev-unknown", st?.isLive == null);
  card.classList.toggle("sev-error", st?.ok === false);
  card.classList.toggle("sevPulse", shouldSevPulse(st));
  card.dataset.user = st.username;
  card.innerHTML = `
    <div class="profileCell">
      <span class="avatar" style="${avatarStyle(st.username)}" aria-hidden="true">${avatarLetter(st.username)}</span>
      <b>@${st.username}</b>
      <span class="pill ${p.cls}">${p.text}</span>
    </div>
    <div class="kanbanMeta">
      <span class="mono">${formatTime(st.checkedAt)}</span>
      <span class="mono">${st.isLive === true ? (st.roomId ? String(st.roomId) : "—") : formatLastLive(st)}</span>
    </div>
  `;
}

function renderKanban(listEl, rows) {
  const wrap = ensureKanbanSkeleton(listEl);
  const reduce = prefersReducedMotion();

  const first = new Map();
  for (const el of wrap.querySelectorAll(".kanbanCard[data-user]")) {
    first.set(el.dataset.user, el.getBoundingClientRect());
  }

  const buckets = {
    live: rows.filter((st) => st.isLive === true),
    offline: rows.filter((st) => st.isLive === false),
    unknown: rows.filter((st) => st.isLive == null)
  };

  for (const k of ["live", "offline", "unknown"]) {
    const cnt = wrap.querySelector(`[data-count="${k}"]`);
    if (cnt) cnt.textContent = String(buckets[k].length);
  }

  const keep = new Set(rows.map((r) => r.username));

  for (const k of ["live", "offline", "unknown"]) {
    const list = wrap.querySelector(`.kanbanList[data-list="${k}"]`);
    if (!list) continue;

    for (const st of buckets[k]) {
      let card = kanbanCardByUser.get(st.username);
      const isNew = !card;
      if (!card) {
        card = document.createElement("div");
        card.className = "kanbanCard";
        card.dataset.user = st.username;
        card.addEventListener("click", () => openDetails(card.dataset.user));
        kanbanCardByUser.set(st.username, card);
      }
      updateKanbanCard(card, st);
      list.appendChild(card);

      const prevBucket = lastKanbanBucketByUser.get(st.username);
      const nextBucket = bucketKeyFor(st);
      if (prevBucket && prevBucket !== nextBucket && !reduce) {
        flashKanbanColumn(wrap, nextBucket);
      }
      lastKanbanBucketByUser.set(st.username, nextBucket);

      if (isNew && !reduce) {
        card.animate(
          [{ opacity: 0, transform: "translateY(6px) scale(0.98)" }, { opacity: 1, transform: "translateY(0) scale(1)" }],
          { duration: 180, easing: "cubic-bezier(.2,.9,.2,1)" }
        );
      }
    }

    const empty = list.querySelector(".kanbanEmpty");
    const hasCards = Boolean(list.querySelector(".kanbanCard"));
    if (!hasCards && !empty) {
      const e = document.createElement("div");
      e.className = "kanbanEmpty muted";
      e.textContent = k === "live" ? "No LIVE right now" : k === "offline" ? "No offline profiles" : "No unknown profiles";
      list.appendChild(e);
    } else if (hasCards && empty) {
      empty.remove();
    }
  }

  for (const [u, card] of kanbanCardByUser.entries()) {
    if (keep.has(u)) continue;
    kanbanCardByUser.delete(u);
    lastKanbanBucketByUser.delete(u);
    if (!reduce) {
      const anim = card.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, easing: "ease-out" });
      anim.onfinish = () => card.remove();
    } else {
      card.remove();
    }
  }

  if (reduce) return;

  for (const [u, r0] of first.entries()) {
    const el = kanbanCardByUser.get(u);
    if (!el || !el.isConnected) continue;
    const r1 = el.getBoundingClientRect();
    const dx = r0.left - r1.left;
    const dy = r0.top - r1.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
    el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }], {
      duration: 220,
      easing: "cubic-bezier(.2,.9,.2,1)"
    });
  }
}

function setStatus(msg) {
  const sub = document.getElementById("subtitle");
  if (!sub) return;
  const prev = sub.textContent;
  sub.textContent = msg || prev;
  if (msg) setTimeout(() => (sub.textContent = prev), 2000);
}

function formatTime(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDate(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleDateString();
}

function formatDurationSince(ts) {
  if (!ts) return "—";
  const ms = Date.now() - ts;
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const m = Math.floor(ms / 60000);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (h > 0) return `${h}h ${mm}m`;
  return `${mm}m`;
}

function formatLastLive(st) {
  if (st?.isLive === true) return formatDurationSince(st.lastChangeAt);
  if (st?.lastLiveSeenAt) return `Last: ${formatDurationSince(st.lastLiveSeenAt)}`;
  return "—";
}

function lastLiveMini(st) {
  const now = Date.now();
  const ts = st?.isLive === true ? Number(st.lastChangeAt || 0) : Number(st.lastLiveSeenAt || 0);
  if (!Number.isFinite(ts) || ts <= 0) return { label: "—", title: "No LIVE seen yet", p: 0 };
  const ageMs = Math.max(0, now - ts);
  const windowMs = 7 * 24 * 60 * 60 * 1000;
  const p = Math.max(0, Math.min(1, 1 - ageMs / windowMs));
  const label = formatLastLive(st);
  const title = `${st?.isLive === true ? "LIVE for" : "Last LIVE"} ${formatDurationSince(ts)} • ${new Date(ts).toLocaleString()}`;
  return { label, title, p };
}

function sparklineForUser(username, days = 7) {
  const u = normalizeUsername(username);
  if (!u) return "";
  const keys = lastNDaysKeys(days);
  const map = new Map(keys.map((k) => [k, 0]));
  for (const e of historyAll || []) {
    if (e?.type !== "live_started") continue;
    if (normalizeUsername(e.username) !== u) continue;
    const k = dayKey(e.ts);
    if (map.has(k)) map.set(k, (map.get(k) || 0) + 1);
  }
  const vals = keys.map((k) => map.get(k) || 0);
  const max = Math.max(1, ...vals);
  const bars = vals
    .map((v) => {
      const h = Math.max(0.06, Math.min(1, v / max));
      return `<span class="sparkBar" style="--h:${h}"></span>`;
    })
    .join("");
  const title = `LIVE starts (last ${days} days): ${vals.join(", ")}`;
  return `<span class="spark" title="${title.replace(/"/g, "&quot;")}">${bars}</span>`;
}

function pill(isLive) {
  if (isLive === true) return { text: "LIVE", cls: "live" };
  if (isLive === false) return { text: "offline", cls: "offline" };
  return { text: "unknown", cls: "unknown" };
}

function severityClassFor(st) {
  if (st?.ok === false) return "sev-error";
  if (st?.isLive === true) return "sev-live";
  if (st?.isLive === false) return "sev-offline";
  return "sev-unknown";
}

function shouldSevPulse(st) {
  const now = Date.now();
  const ch = Number(st?.lastChangeAt || 0);
  const err = st?.ok === false ? Number(st?.checkedAt || 0) : 0;
  const ts = Math.max(ch, err);
  if (!Number.isFinite(ts) || ts <= 0) return false;
  return now - ts < 25 * 1000;
}

function updateStatusSegmented() {
  const wrap = document.querySelector(".statusSeg");
  if (!wrap) return;
  for (const b of wrap.querySelectorAll("button[data-sfilter]")) {
    const key = b.getAttribute("data-sfilter");
    b.classList.toggle("active", key === statusFilter);
  }
}

function isToday(ts) {
  if (!ts) return false;
  const d = new Date(ts);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

function renderKPIs() {
  const liveEl = document.getElementById("kpiLive");
  const watchEl = document.getElementById("kpiWatching");
  const giftsEl = document.getElementById("kpiGifts");
  const errEl = document.getElementById("kpiErrors");
  const card = document.getElementById("kpiCard");
  if (!liveEl || !watchEl || !giftsEl || !errEl || !card) return;

  const layout = String(settings?.dashboardLayout || "default");
  card.hidden = layout !== "cards";

  const byUser = state.byUser || {};
  const liveCount = Object.values(byUser).filter((x) => x?.isLive === true).length;
  const watchingCount = uniqUsernames(watchUsersState || []).length;
  const giftsToday = (historyAll || []).filter((e) => e?.type === "gift_sent" && isToday(e.ts)).length;
  const errorsToday = (historyAll || []).filter((e) => e?.type === "error" && isToday(e.ts)).length;

  animateNumberText(liveEl, liveCount);
  animateNumberText(watchEl, watchingCount);
  animateNumberText(giftsEl, giftsToday);
  animateNumberText(errEl, errorsToday);
}

function renderStatus() {
  const summaryEl = document.getElementById("summary");
  const listEl = document.getElementById("statusList");
  const chipLive = document.getElementById("chipLive");
  const chipUnknown = document.getElementById("chipUnknown");
  const headerEl = document.getElementById("statusTableHeader");
  const view = String(settings?.dashboardView || "table");
  if (headerEl) headerEl.hidden = view === "kanban";
  updateStatusSegmented();
  const reduce = prefersReducedMotion();
  const first = new Map();
  if (view !== "kanban" && !reduce) {
    for (const el of listEl.querySelectorAll(".statusRow[data-user]")) {
      first.set(el.dataset.user, el.getBoundingClientRect());
    }
  }
  if (view !== "kanban") listEl.innerHTML = "";

  if (!usernamesState.length) {
    const wrap = document.createElement("div");
    wrap.className = "emptyState";
    wrap.innerHTML = `
      <div class="emptyTitle">Setup checklist</div>
      <div class="emptySub">Complete these steps to start monitoring.</div>
      <div class="emptyChecklist">
        <div class="checkItem"><span class="checkDot"></span><div><b>Add profiles</b><div class="muted">Add host usernames to monitor.</div></div></div>
        <div class="checkItem"><span class="checkDot"></span><div><b>Enable tracking</b><div class="muted">Turn on Auto Track All LIVE (optional).</div></div></div>
        <div class="checkItem"><span class="checkDot"></span><div><b>Add watched viewers</b><div class="muted">Get join/gift alerts for specific viewers.</div></div></div>
      </div>
      <div class="actions" style="margin-top:0;">
        <button class="btn primary" type="button" id="emptyOpenSettings">Open Settings</button>
        <button class="btn ghost" type="button" id="emptyOpenJoin">Join Tracker</button>
      </div>
    `;
    listEl.appendChild(wrap);
    wrap.querySelector("#emptyOpenSettings").addEventListener("click", async () => {
      await window.api.openSettingsPopup();
    });
    wrap.querySelector("#emptyOpenJoin").addEventListener("click", async () => {
      await window.api.openJoinTrackerPopup(null);
    });
    if (summaryEl) summaryEl.textContent = "Add profiles to get started.";
    if (chipLive) chipLive.textContent = "LIVE: —";
    if (chipUnknown) chipUnknown.textContent = "Unknown: —";
    return;
  }

  const byUser = state.byUser || {};
  const liveCount = Object.values(byUser).filter((x) => x?.isLive === true).length;
  const unknownCount = Object.values(byUser).filter((x) => x?.isLive == null).length;
  const errorCount = Object.values(byUser).filter((x) => x?.ok === false).length;
  if (chipLive) {
    const v = chipLive.querySelector(".value");
    if (v) animateNumberText(v, liveCount);
    chipLive.classList.toggle("live", liveCount > 0);
    chipLive.title = `${liveCount} LIVE profiles`;
  }
  if (chipUnknown) {
    const v = chipUnknown.querySelector(".value");
    if (v) animateNumberText(v, unknownCount);
    chipUnknown.classList.toggle("warn", unknownCount > 0);
    chipUnknown.title = `${unknownCount} unknown profiles`;
  }
  summaryEl.textContent = liveCount
    ? `${liveCount} LIVE right now`
    : unknownCount
      ? `No confirmed LIVE (${unknownCount} unknown)`
      : "No LIVE right now";

  const q = statusSearch.trim().toLowerCase();
  const rows = usernamesState
    .map((u) => byUser[u] || { username: u, isLive: null, confidence: "low" })
    .filter((st) => (!q ? true : String(st.username || "").toLowerCase().includes(q)))
    .filter((st) => {
      if (statusFilter === "live") return st.isLive === true;
      if (statusFilter === "offline") return st.isLive === false;
      if (statusFilter === "unknown") return st.isLive == null;
      if (statusFilter === "error") return st.ok === false;
      return true;
    });

  const pinned = pinnedSet();
  const pinnedCmp = (a, b) => {
    const ap = pinned.has(a.username) ? 0 : 1;
    const bp = pinned.has(b.username) ? 0 : 1;
    if (ap !== bp) return ap - bp;
    return 0;
  };

  const sorters = {
    liveFirst: (a, b) => {
      const pin = pinnedCmp(a, b);
      if (pin) return pin;
      const av = a.isLive === true ? 0 : a.isLive === false ? 1 : 2;
      const bv = b.isLive === true ? 0 : b.isLive === false ? 1 : 2;
      if (av !== bv) return av - bv;
      return String(a.username).localeCompare(String(b.username));
    },
    checkedDesc: (a, b) => pinnedCmp(a, b) || (b.checkedAt || 0) - (a.checkedAt || 0),
    nameAsc: (a, b) => pinnedCmp(a, b) || String(a.username).localeCompare(String(b.username))
  };
  rows.sort(sorters[statusSort] || sorters.liveFirst);

  if (view === "kanban") {
    renderKanban(listEl, rows);
    return;
  }

  if (!rows.length) {
    const wrap = document.createElement("div");
    wrap.className = "emptyState";
    wrap.innerHTML = `
      <div class="emptyTitle">No results</div>
      <div class="emptySub">Check filters/search and try again.</div>
      <div class="actions" style="margin-top:0;">
        <button class="btn" type="button" id="emptyResetFilters">Reset filters</button>
      </div>
    `;
    listEl.appendChild(wrap);
    wrap.querySelector("#emptyResetFilters").addEventListener("click", () => {
      statusSearch = "";
      statusFilter = "all";
      statusSort = "liveFirst";
      const sEl = document.getElementById("statusSearch");
      const fEl = document.getElementById("statusFilter");
      const soEl = document.getElementById("statusSort");
      if (sEl) sEl.value = "";
      if (fEl) fEl.value = "all";
      if (soEl) soEl.value = "liveFirst";
      renderStatus();
    });
    return;
  }

  for (const st of rows) {
    const p = pill(st.isLive);
    const liveMini = lastLiveMini(st);
    const lastErr = st.ok === false ? (st.error || st.reason || "error") : "";
    const room = st.roomId ? String(st.roomId) : "";

    const row = document.createElement("div");
    row.className = `statusRow animIn ${severityClassFor(st)}${shouldSevPulse(st) ? " sevPulse" : ""}`;
    row.dataset.user = st.username;
    row.innerHTML = `
      <div class="profileCell">
        <span class="avatar" style="${avatarStyle(st.username)}" aria-hidden="true">${avatarLetter(st.username)}</span>
        <div class="profileText">
          <b>@${st.username}</b>
          ${sparklineForUser(st.username, 7)}
        </div>
      </div>
      <div><span class="pill ${p.cls}">${p.text}</span></div>
      <div class="lastLiveCell" title="${liveMini.title.replace(/"/g, "&quot;")}">
        <span class="liveMini" style="--p:${liveMini.p}"></span>
        <span class="mono muted">${liveMini.label}</span>
      </div>
      <div class="mono muted">${formatTime(st.checkedAt)}</div>
      <div class="mono muted">${st.confidence || "—"}</div>
      <div class="roomCell">
        ${
          room
            ? `<button class="copyChip mono" type="button" data-copy="${room}" data-tip="Copy roomId" aria-label="Copy roomId">${room}</button>`
            : `<span class="mono muted">—</span>`
        }
      </div>
      <div class="muted truncate" title="${lastErr ? String(lastErr).replace(/"/g, "&quot;") : ""}">${lastErr ? "!" : "—"}</div>
      <div class="statusActions">
        <button class="iconBtn hasTip" type="button" data-pinrow="${st.username}" data-tip="${pinnedSet().has(st.username) ? "Unpin" : "Pin"}" aria-label="Pin">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="2">
            <path d="M12 17l-5 3 1.2-5.8L4 9.6l5.9-.6L12 3l2.1 6 5.9.6-4.2 4.6L17 20z"></path>
          </svg>
        </button>
        <button class="iconBtn hasTip" type="button" data-copyuser="${st.username}" data-tip="Copy @username" aria-label="Copy username">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="2">
            <path d="M8 8h12v12H8z"></path>
            <path d="M4 16H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v1"></path>
          </svg>
        </button>
        <button class="iconBtn hasTip" type="button" data-chat="${st.username}" data-tip="Chat" aria-label="Chat">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="2">
            <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"></path>
          </svg>
        </button>
        <button class="iconBtn hasTip" type="button" data-track="${st.username}" data-tip="Join Tracker" aria-label="Join Tracker">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="2">
            <circle cx="12" cy="7" r="3"></circle>
            <path d="M5.5 21a6.5 6.5 0 0 1 13 0"></path>
            <path d="M19 8v6"></path>
            <path d="M22 11h-6"></path>
          </svg>
        </button>
        <button class="iconBtn hasTip" type="button" data-open="${st.username}" data-tip="Overlay" aria-label="Overlay">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="2">
            <path d="M14 3h7v7"></path>
            <path d="M10 14L21 3"></path>
            <path d="M21 14v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h6"></path>
          </svg>
        </button>
      </div>
    `;
    listEl.appendChild(row);

    row.addEventListener("click", async () => {
      openDetails(st.username);
    });
  }

  listEl.querySelectorAll("button[data-copy]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const v = btn.getAttribute("data-copy");
      if (!v) return;
      try {
        await navigator.clipboard.writeText(v);
        btn.classList.add("copied");
        setTimeout(() => btn.classList.remove("copied"), 600);
      } catch {
        setStatus("Could not copy.");
      }
    });
  });

  listEl.querySelectorAll("button[data-open]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const u = btn.getAttribute("data-open");
      if (!u) return;
      await window.api.openOverlay(u);
    });
  });

  listEl.querySelectorAll("button[data-pinrow]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const u = btn.getAttribute("data-pinrow");
      if (!u) return;
      togglePinned(u);
      toast("Pinned updated.");
      renderLiveStrip();
      renderStatus();
    });
  });

  listEl.querySelectorAll("button[data-copyuser]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const u = normalizeUsername(btn.getAttribute("data-copyuser"));
      if (!u) return;
      try {
        await navigator.clipboard.writeText(`@${u}`);
        toast("Copied username.");
      } catch {
        setStatus("Could not copy.");
      }
    });
  });

  listEl.querySelectorAll("button[data-chat]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const u = btn.getAttribute("data-chat");
      if (!u) return;
      try {
        const res = await window.api.openChatPopup(u);
        if (!res?.ok) {
          setStatus("Could not open the chat window (see History for details).");
        }
      } catch (err) {
        setStatus(`Error: ${String(err?.message || err).slice(0, 80)}`);
      }
    });
  });

  listEl.querySelectorAll("button[data-track]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const u = btn.getAttribute("data-track");
      if (!u) return;
      await window.api.openJoinTrackerPopup(u);
    });
  });

  if (!reduce && first.size) {
    for (const el of listEl.querySelectorAll(".statusRow[data-user]")) {
      const r0 = first.get(el.dataset.user);
      if (!r0) continue;
      const r1 = el.getBoundingClientRect();
      const dx = r0.left - r1.left;
      const dy = r0.top - r1.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0,0)" }], {
        duration: 220,
        easing: "cubic-bezier(.2,.9,.2,1)"
      });
    }
  }
}

function dayLabel(ts) {
  const d = new Date(ts);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startThat = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startToday - startThat) / (24 * 60 * 60 * 1000));
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return d.toLocaleDateString();
}

function notifyTabToTypes(tab) {
  if (tab === "live") return ["live_started"];
  if (tab === "joins") return ["viewer_joined"];
  if (tab === "gifts") return ["gift_sent"];
  if (tab === "warn") return ["rate_limited"];
  return ["live_started", "viewer_joined", "gift_sent", "rate_limited"];
}

function getNotifyEvents(tab) {
  const allowed = new Set(notifyTabToTypes(tab));
  return (historyAll || []).filter((e) => allowed.has(e.type));
}

function computeUnreadCountFor(events) {
  const last = notifLastReadAt || 0;
  return (events || []).filter((e) => (e?.ts || 0) > last).length;
}

function renderNotifyTabs() {
  const wrap = document.querySelector(".drawerTabs");
  if (!wrap) return;
  const btns = Array.from(wrap.querySelectorAll("button[data-ntab]"));
  const allEvents = getNotifyEvents("all");
  const counts = {
    all: allEvents.length,
    live: getNotifyEvents("live").length,
    joins: getNotifyEvents("joins").length,
    gifts: getNotifyEvents("gifts").length,
    warn: getNotifyEvents("warn").length
  };
  const unread = {
    all: computeUnreadCountFor(allEvents),
    live: computeUnreadCountFor(getNotifyEvents("live")),
    joins: computeUnreadCountFor(getNotifyEvents("joins")),
    gifts: computeUnreadCountFor(getNotifyEvents("gifts")),
    warn: computeUnreadCountFor(getNotifyEvents("warn"))
  };
  for (const b of btns) {
    const key = b.getAttribute("data-ntab");
    b.classList.toggle("active", key === notifyTab);
    const base =
      key === "all" ? "All" : key === "live" ? "LIVE" : key === "joins" ? "Joins" : key === "gifts" ? "Gifts" : "Warnings";
    const u = unread[key] ? ` • ${unread[key]}` : "";
    b.textContent = `${base} (${counts[key] ?? 0})${u}`;
  }
  updateTabIndicator();
}

function updateTabIndicator() {
  const wrap = document.querySelector(".drawerTabs");
  const ind = wrap?.querySelector(".tabIndicator");
  if (!wrap || !ind) return;
  const active = wrap.querySelector(`button[data-ntab="${notifyTab}"]`);
  if (!active) return;
  const rW = wrap.getBoundingClientRect();
  const rA = active.getBoundingClientRect();
  const left = rA.left - rW.left;
  ind.style.width = `${Math.max(24, rA.width - 12)}px`;
  ind.style.transform = `translateX(${left + 6}px)`;
}

function renderNotifications() {
  const list = document.getElementById("notifyList");
  if (!list) return;
  list.innerHTML = "";
  renderNotifyTabs();
  const events = getNotifyEvents(notifyTab).slice(0, 80);
  notifications = events.slice(0, 30);

  if (!events.length) {
    const empty = document.createElement("div");
    empty.className = "emptyState";
    empty.innerHTML = `
      <div class="emptyTitle">No notifications</div>
      <div class="emptySub">No events for this tab. If you expect Joins/Gifts, start Join Tracker (All LIVE) or enable Auto Track All LIVE.</div>
      <div class="actions" style="margin-top:0;">
        <button class="btn ghost" type="button" id="emptyOpenHistory">History</button>
        <button class="btn" type="button" id="emptyOpenJoin">Join Tracker</button>
        <button class="btn primary" type="button" id="emptyOpenSettings">Settings</button>
      </div>
    `;
    list.appendChild(empty);
    empty.querySelector("#emptyOpenHistory")?.addEventListener("click", async () => await window.api.openHistoryPopup());
    empty.querySelector("#emptyOpenJoin")?.addEventListener("click", async () => await window.api.openJoinTrackerPopup(null));
    empty.querySelector("#emptyOpenSettings")?.addEventListener("click", async () => await window.api.openSettingsPopup());
    return;
  }

  const iconSvg = (name) => {
    if (name === "live") {
      return `
        <svg viewBox="0 0 24 24" fill="none" stroke-width="2">
          <path d="M4 12a8 8 0 0 1 8-8"></path>
          <path d="M4 12a8 8 0 0 0 8 8"></path>
          <path d="M20 12a8 8 0 0 0-8-8"></path>
          <path d="M20 12a8 8 0 0 1-8 8"></path>
          <circle cx="12" cy="12" r="2.5"></circle>
        </svg>
      `;
    }
    if (name === "join") {
      return `
        <svg viewBox="0 0 24 24" fill="none" stroke-width="2">
          <circle cx="12" cy="8" r="3"></circle>
          <path d="M5.5 21a6.5 6.5 0 0 1 13 0"></path>
          <path d="M19 8v6"></path>
          <path d="M22 11h-6"></path>
        </svg>
      `;
    }
    return `
      <svg viewBox="0 0 24 24" fill="none" stroke-width="2">
        <path d="M12 9v4"></path>
        <path d="M12 17h.01"></path>
        <path d="M10.3 3.3h3.4L21 10.6v3.4L13.7 21h-3.4L3 13.7v-3.4z"></path>
      </svg>
    `;
  };

  const relTime = (ts) => {
    if (!ts) return "—";
    const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 48) return `${h}h`;
    const d = Math.floor(h / 24);
    return `${d}d`;
  };

  let lastDay = "";
  for (const n of events) {
    const curDay = n?.ts ? dayLabel(n.ts) : "—";
    if (curDay !== lastDay) {
      lastDay = curDay;
      const h = document.createElement("div");
      h.className = "notifyDay";
      h.textContent = curDay;
      list.appendChild(h);
    }
    const row = document.createElement("div");
    const unread = (n?.ts || 0) > (notifLastReadAt || 0);
    row.className = `notifyItem animIn${unread ? " unread" : ""}`;
    const type = n.type || "event";
    const when = n.ts ? `${relTime(n.ts)} • ${formatTime(n.ts)}` : "—";
    const title =
      type === "live_started"
        ? `@${n.username} started LIVE`
        : type === "viewer_joined"
          ? `@${String(n.error || "").trim()} joined @${n.username}`
          : type === "gift_sent"
            ? `Gift in @${n.username}`
          : type === "rate_limited"
            ? `Cooldown / rate limited`
          : `${type}`;

    const iconCls =
      type === "live_started"
        ? "live"
        : type === "viewer_joined"
          ? "join"
          : type === "gift_sent"
            ? "warn"
            : type === "rate_limited"
              ? "warn"
              : "";
    const iconName = type === "live_started" ? "live" : type === "viewer_joined" ? "join" : "warn";
    const tagCls = iconCls || "";
    const subtitle =
      type === "live_started"
        ? "Click: open overlay"
        : type === "viewer_joined"
          ? "Click: open chat"
          : type === "gift_sent"
            ? "Click: open chat"
          : type === "rate_limited"
            ? "Click: open History"
            : type;

    row.innerHTML = `
      <div class="notifyIcon ${iconCls}">${iconSvg(iconName)}</div>
      <div class="notifyBody">
        <div class="notifyTitleRow">
          <div class="notifyTitle">${title}</div>
          <div class="notifyWhen mono muted" title="${n.ts ? new Date(n.ts).toLocaleString() : ""}">${when}</div>
        </div>
        <div class="notifySub">${subtitle}</div>
        <div class="notifyMeta">
          <span class="notifyTag ${tagCls}">${type}</span>
        </div>
      </div>
    `;

    if (n?.id && !seenNotifIds.has(n.id) && !prefersReducedMotion()) {
      seenNotifIds.add(n.id);
      row.classList.add("newEvent");
      setTimeout(() => row.classList.remove("newEvent"), 600);
    } else if (n?.id) {
      seenNotifIds.add(n.id);
    }

    row.addEventListener("click", async () => {
      if (type === "live_started") await window.api.openOverlay(n.username);
      else if (type === "viewer_joined") await window.api.openChatPopup(n.username);
      else if (type === "gift_sent") await window.api.openChatPopup(n.username);
      else if (type === "rate_limited") await window.api.openHistoryPopup();
    });

    list.appendChild(row);
  }
}

function setNotifCount(n) {
  const el = document.getElementById("notifCount");
  if (!el) return;
  const count = Number(n || 0);
  if (!Number.isFinite(count) || count <= 0) {
    el.hidden = true;
    el.textContent = "0";
    return;
  }
  el.hidden = false;
  animateNumberText(el, Math.min(99, count));
}

function computeUnreadCount() {
  return computeUnreadCountFor(getNotifyEvents("all"));
}

function setDrawer(open) {
  const drawer = document.getElementById("notifyDrawer");
  const overlay = document.getElementById("drawerOverlay");
  if (!drawer || !overlay) return;
  drawer.hidden = !open;
  overlay.hidden = !open;
  if (open) renderNotifications();
}

function setDetailsOpen(open) {
  const drawer = document.getElementById("detailsDrawer");
  const overlay = document.getElementById("detailsOverlay");
  if (!drawer || !overlay) return;
  drawer.hidden = !open;
  overlay.hidden = !open;
}

function openDetails(username) {
  const u = String(username || "").trim();
  if (!u) return;
  const st = (state.byUser || {})[u] || { username: u };
  const detailsSub = document.getElementById("detailsSub");
  const detailsBody = document.getElementById("detailsBody");
  if (detailsSub) detailsSub.textContent = `@${u}`;
  if (!detailsBody) return;

  const p = pill(st.isLive);
  const recent = (historyAll || []).filter((e) => e.username === u).slice(0, 10);
  const globalMin = Math.max(1, Math.min(60, Math.round(Number(settings?.intervalMinutes || 1))));
  const perMap = settings?.perHostIntervals && typeof settings.perHostIntervals === "object" ? settings.perHostIntervals : {};
  const override = Math.round(Number(perMap[u] || 0));
  const overrideText = override ? String(override) : "";
  detailsBody.innerHTML = `
    <div class="detailsSplit">
      <div class="detailsLeft">
        <div class="detailsGrid">
      <div class="detailsCard">
        <div class="detailsKey">Status</div>
        <div class="detailsVal"><span class="pill ${p.cls}">${p.text}</span></div>
      </div>
      <div class="detailsCard">
        <div class="detailsKey">Last check</div>
        <div class="detailsVal mono">${formatTime(st.checkedAt)}</div>
      </div>
      <div class="detailsCard">
        <div class="detailsKey">Last LIVE seen</div>
        <div class="detailsVal mono">${st.lastLiveSeenAt ? `${formatDate(st.lastLiveSeenAt)} ${formatTime(st.lastLiveSeenAt)}` : "—"}</div>
      </div>
      <div class="detailsCard">
        <div class="detailsKey">Policy interval</div>
        <div class="detailsVal">
          <div class="policyInline">
            <input id="policyOverride" class="input mono" type="number" min="1" max="60" placeholder="${globalMin}" value="${overrideText}" />
            <button id="policySave" class="btn" type="button">Save</button>
            <button id="policyClear" class="btn ghost" type="button" ${override ? "" : "disabled"}>Use global</button>
          </div>
          <div class="hint">Global: ${globalMin}m • Leave empty to use global. Saved only if different.</div>
        </div>
      </div>
      <div class="detailsCard">
        <div class="detailsKey">Next due</div>
        <div class="detailsVal mono">${st.nextDueAt ? `${formatTime(st.nextDueAt)}` : "—"}</div>
      </div>
      <div class="detailsCard">
        <div class="detailsKey">Room</div>
        <div class="detailsVal mono">${st.roomId ? String(st.roomId) : "—"}</div>
      </div>
      <div class="detailsCard">
        <div class="detailsKey">Viewers</div>
        <div class="detailsVal mono">${
          Number.isFinite(Number(st.viewerCount)) ? Math.round(Number(st.viewerCount)) : "—"
        }</div>
      </div>
      <div class="detailsCard">
        <div class="detailsKey">Last error</div>
        <div class="detailsVal mono">${st.ok === false ? String(st.error || st.reason || "error").slice(0, 140) : "—"}</div>
      </div>
        </div>

    <div class="detailsActions">
      <button class="iconBtn hasTip" type="button" id="detailsChat" data-tip="Chat" aria-label="Chat">
        <svg viewBox="0 0 24 24" fill="none" stroke-width="2">
          <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"></path>
        </svg>
      </button>
      <button class="iconBtn hasTip" type="button" id="detailsOverlayBtn" data-tip="Overlay" aria-label="Overlay">
        <svg viewBox="0 0 24 24" fill="none" stroke-width="2">
          <path d="M14 3h7v7"></path>
          <path d="M10 14L21 3"></path>
          <path d="M21 14v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h6"></path>
        </svg>
      </button>
      <button class="iconBtn hasTip" type="button" id="detailsJoin" data-tip="Join Tracker" aria-label="Join Tracker">
        <svg viewBox="0 0 24 24" fill="none" stroke-width="2">
          <circle cx="12" cy="7" r="3"></circle>
          <path d="M5.5 21a6.5 6.5 0 0 1 13 0"></path>
          <path d="M19 8v6"></path>
          <path d="M22 11h-6"></path>
        </svg>
      </button>
      <button class="iconBtn hasTip" type="button" id="detailsHistory" data-tip="History" aria-label="History">
        <svg viewBox="0 0 24 24" fill="none" stroke-width="2">
          <path d="M3 3v5h5"></path>
          <path d="M3.05 13a9 9 0 1 0 .5-4.5L3 8"></path>
          <path d="M12 7v6l4 2"></path>
        </svg>
      </button>
    </div>

      </div>

      <div class="detailsRight">
        <div class="h3" style="margin-top:0;">Recent events</div>
        <div class="detailsEvents">
          ${
            recent.length
              ? recent
                  .map(
                    (e) => `
                      <div class="activityItem" style="cursor:default;">
                        <div class="activityTop">
                          <div class="activityTitle">${e.type || "event"}</div>
                          <div class="mono muted">${e.ts ? formatTime(e.ts) : "—"}</div>
                        </div>
                        <div class="activityMeta">${e.reason || ""} ${e.error ? `• ${String(e.error).slice(0, 160)}` : ""}</div>
                      </div>
                    `
                  )
                  .join("")
              : `<div class="muted">No events for this profile.</div>`
          }
        </div>
      </div>
    </div>
  `;

  detailsBody.querySelector("#detailsChat")?.addEventListener("click", async () => {
    await window.api.openChatPopup(u);
  });
  detailsBody.querySelector("#detailsOverlayBtn")?.addEventListener("click", async () => {
    await window.api.openOverlay(u);
  });
  detailsBody.querySelector("#detailsJoin")?.addEventListener("click", async () => {
    await window.api.openJoinTrackerPopup(u);
  });
  detailsBody.querySelector("#detailsHistory")?.addEventListener("click", async () => {
    await window.api.openHistoryPopup();
  });

  const input = detailsBody.querySelector("#policyOverride");
  const btnSave = detailsBody.querySelector("#policySave");
  const btnClear = detailsBody.querySelector("#policyClear");
  const saveOverride = async (val) => {
    const raw = String(val ?? "").trim();
    const nextMap = { ...(settings?.perHostIntervals || {}) };
    if (!raw) {
      delete nextMap[u];
    } else {
      const m = Math.round(Number(raw));
      if (!Number.isFinite(m) || m < 1 || m > 60) {
        setStatus("Interval must be 1–60 minutes.");
        return;
      }
      if (m === globalMin) delete nextMap[u];
      else nextMap[u] = m;
    }
    try {
      settings = await window.api.setSettings({ ...settings, perHostIntervals: nextMap });
      window.__applyTheme?.(settings);
      toast("Policy saved.");
      renderStatus();
      openDetails(u);
    } catch (err) {
      setStatus(`Error: ${String(err?.message || err).slice(0, 80)}`);
    }
  };
  btnSave?.addEventListener("click", async () => await saveOverride(input?.value));
  btnClear?.addEventListener("click", async () => await saveOverride(""));
  input?.addEventListener("keydown", async (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      await saveOverride(input.value);
    }
  });

  setDetailsOpen(true);
}

function renderActivity() {
  const el = document.getElementById("activityList");
  if (!el) return;
  const events = (historyAll || []).filter((e) => NOTIFY_TYPES.has(e.type) || e.type === "error").slice(0, 6);
  el.innerHTML = "";
  if (!events.length) {
    const empty = document.createElement("div");
    empty.className = "emptyState";
    empty.innerHTML = `
      <div class="emptyTitle">No activity</div>
      <div class="emptySub">Events will appear for LIVE / joins / gifts / warnings.</div>
    `;
    el.appendChild(empty);
    return;
  }

  for (const e of events) {
    const row = document.createElement("div");
    row.className = "activityItem animIn";
    const title =
      e.type === "live_started"
        ? `@${e.username} LIVE`
        : e.type === "viewer_joined"
          ? `@${String(e.error || "").trim()} → @${e.username}`
          : e.type === "rate_limited"
            ? "Cooldown / rate limited"
            : e.type === "error"
              ? `Error @${e.username || "—"}`
              : e.type;
    row.innerHTML = `
      <div class="activityTop">
        <div class="activityTitle">${title}</div>
        <div class="mono muted">${e.ts ? formatTime(e.ts) : "—"}</div>
      </div>
      <div class="activityMeta">${e.type}${e.reason ? ` • ${e.reason}` : ""}</div>
    `;
    row.addEventListener("click", async () => {
      if (e.type === "live_started") await window.api.openOverlay(e.username);
      else if (e.type === "viewer_joined") await window.api.openChatPopup(e.username);
      else await window.api.openHistoryPopup();
    });
    el.appendChild(row);
  }
}

function parseGiftError(err) {
  const raw = String(err || "").trim();
  if (!raw) return { viewer: "", summary: "" };
  const parts = raw.split(" • ");
  const viewer = normalizeUsername(parts[0] || "");
  const summary = parts.slice(1).join(" • ").trim();
  return { viewer, summary };
}

function renderGiftsCard() {
  const el = document.getElementById("giftsList");
  if (!el) return;
  const events = (historyAll || []).filter((e) => e?.type === "gift_sent").slice(0, 6);
  el.innerHTML = "";

  if (!events.length) {
    const empty = document.createElement("div");
    empty.className = "emptyState";
    empty.innerHTML = `
      <div class="emptyTitle">No gifts</div>
      <div class="emptySub">They will appear when Join Tracker is active and a watched viewer sends a gift.</div>
    `;
    el.appendChild(empty);
    return;
  }

  for (const e of events) {
    const row = document.createElement("div");
    row.className = "activityItem animIn";
    const host = normalizeUsername(e.username || "");
    const { viewer, summary } = parseGiftError(e.error);
    const title = viewer ? `@${viewer} → @${host || "—"}` : `Gift → @${host || "—"}`;
    row.innerHTML = `
      <div class="activityTop">
        <div class="activityTitle">${title}</div>
        <div class="mono muted">${e.ts ? formatTime(e.ts) : "—"}</div>
      </div>
      <div class="activityMeta">gift_sent${summary ? ` • ${summary}` : ""}</div>
    `;
    row.addEventListener("click", async () => {
      if (host) await window.api.openChatPopup(host);
      else await window.api.openJoinTrackerPopup(null);
    });
    el.appendChild(row);
  }
}

function lastNDaysKeys(n) {
  const out = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    out.push(key);
  }
  return out;
}

function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function buildSeries(type, days = 14) {
  const keys = lastNDaysKeys(days);
  const map = new Map(keys.map((k) => [k, 0]));
  for (const e of historyAll || []) {
    if (!e?.ts) continue;
    if (e.type !== type) continue;
    const k = dayKey(e.ts);
    if (map.has(k)) map.set(k, (map.get(k) || 0) + 1);
  }
  const vals = keys.map((k) => map.get(k) || 0);
  return { keys, vals };
}

let chartByKey = {};

function destroyCharts() {
  for (const c of Object.values(chartByKey)) {
    try {
      c?.destroy?.();
    } catch {}
  }
  chartByKey = {};
}

function cssVar(name, fallback = "") {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch {
    return fallback;
  }
}

function makeBarChart(canvas, { title, series, color }) {
  if (!canvas || !window.Chart) return null;
  const reduce = prefersReducedMotion();
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const tooltipBg = cssVar("--panel", "rgba(20,20,28,0.94)");
  const tooltipBorder = cssVar("--border", "rgba(255,255,255,0.12)");
  const tooltipText = cssVar("--text", "rgba(232,233,239,0.92)");
  const tooltipMuted = "rgba(232,233,239,0.70)";

  return new window.Chart(ctx, {
    type: "bar",
    data: {
      labels: series.keys,
      datasets: [
        {
          label: title,
          data: series.vals,
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
          backgroundColor: tooltipBg,
          borderColor: tooltipBorder,
          borderWidth: 1,
          titleColor: tooltipText,
          bodyColor: tooltipText,
          footerColor: tooltipMuted,
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

function renderCharts() {
  const el = document.getElementById("charts");
  if (!el) return;
  destroyCharts();
  const live = buildSeries("live_started", 14);
  const joins = buildSeries("viewer_joined", 14);
  const errs = buildSeries("error", 14);
  const total = (s) => s.vals.reduce((a, b) => a + b, 0);
  el.innerHTML = `
    <div class="chartRow">
      <div class="chartTop">
        <div class="chartTitle">LIVE starts</div>
        <div class="chartTotal">Total: ${total(live)}</div>
      </div>
      <div class="chartCanvasWrap">
        <canvas class="chartCanvas" id="chartLive"></canvas>
      </div>
    </div>
    <div class="chartRow">
      <div class="chartTop">
        <div class="chartTitle">Viewer joins</div>
        <div class="chartTotal">Total: ${total(joins)}</div>
      </div>
      <div class="chartCanvasWrap">
        <canvas class="chartCanvas" id="chartJoins"></canvas>
      </div>
    </div>
    <div class="chartRow">
      <div class="chartTop">
        <div class="chartTitle">Errors</div>
        <div class="chartTotal">Total: ${total(errs)}</div>
      </div>
      <div class="chartCanvasWrap">
        <canvas class="chartCanvas" id="chartErrors"></canvas>
      </div>
    </div>
  `;

  const joinColor = cssVar("--accent2", "rgba(99,102,241,0.55)");
  chartByKey.live = makeBarChart(document.getElementById("chartLive"), {
    title: "LIVE starts",
    series: live,
    color: "rgba(34, 197, 94, 0.55)"
  });
  chartByKey.joins = makeBarChart(document.getElementById("chartJoins"), {
    title: "Viewer joins",
    series: joins,
    color: joinColor
  });
  chartByKey.errors = makeBarChart(document.getElementById("chartErrors"), {
    title: "Errors",
    series: errs,
    color: "rgba(239, 68, 68, 0.50)"
  });
}

function renderHealth() {
  const el = document.getElementById("healthRows");
  if (!el) return;
  const s = settings || {};
  const a = appStatus || {};

  const lastCheck = a.lastStatusCheckAt ? formatTime(a.lastStatusCheckAt) : "—";
  const nextCheck = a.nextScheduledCheckAt ? formatTime(a.nextScheduledCheckAt) : "—";
  const statusSock = a.statusSocketConnected ? "connected" : "disconnected";
  const jt = a.joinTrackerSocketConnected ? "connected" : "disconnected";
  const rl = a.rateLimited && a.rateLimitedUntil ? `until ${formatTime(a.rateLimitedUntil)}` : "—";
  const throttle = a.statusThrottled && a.statusThrottledUntil ? `until ${formatTime(a.statusThrottledUntil)}` : "—";
  const jtMode = a.joinTrackerActive ? `${a.joinTrackingMode || "—"}${a.joinTrackedHost ? ` (@${a.joinTrackedHost})` : ""}` : "off";
  const autoAllLive = a.autoTrackAllLive ? "on" : "off";

  const rows = [
    { k: "Status socket", v: statusSock },
    { k: "JoinTracker socket", v: jt },
    { k: "Last status check", v: lastCheck },
    { k: "Next status check", v: nextCheck },
    { k: "Interval (min)", v: String(a.intervalMinutes ?? s.intervalMinutes ?? "—") },
    { k: "Profiles", v: String(a.userCount ?? usernamesState.length ?? "—") },
    { k: "Watched viewers", v: String(a.watchUsersCount ?? "—") },
    { k: "Join Tracker", v: jtMode },
    { k: "Auto All LIVE", v: autoAllLive },
    { k: "Rate limit", v: rl },
    { k: "Status throttled", v: throttle }
  ];

  el.innerHTML = rows
    .map(
      (r) => `
        <div class="healthRow">
          <div class="healthKey">${r.k}</div>
          <div class="healthVal mono">${r.v}</div>
        </div>
      `
    )
    .join("");
}

function renderHealthBadges() {
  const chipSocket = document.getElementById("chipSocket");
  const chipNext = document.getElementById("chipNext");
  const chipCooldown = document.getElementById("chipCooldown");
  if (!chipSocket || !chipNext || !chipCooldown) return;

  const s = appStatus || {};
  const socketOk = Boolean(s.statusSocketConnected);
  chipSocket.querySelector(".value").textContent = socketOk ? "OK" : "DOWN";
  chipSocket.classList.toggle("ok", socketOk);
  chipSocket.classList.toggle("bad", !socketOk);
  chipSocket.title = `Status socket: ${socketOk ? "connected" : "down"}`;

  const now = Date.now();
  const nextAt = Number(s.nextScheduledCheckAt || 0);
  if (!nextAt) chipNext.querySelector(".value").textContent = "—";
  else {
    const sec = Math.max(0, Math.floor((nextAt - now) / 1000));
    const mm = Math.floor(sec / 60);
    const ss = sec % 60;
    chipNext.querySelector(".value").textContent = `${mm}:${String(ss).padStart(2, "0")}`;
  }
  chipNext.title = nextAt ? `Next check at ${new Date(nextAt).toLocaleTimeString()}` : "Next check unknown";

  const until = Number(s.rateLimitedUntil || 0);
  const inCooldown = Boolean(s.rateLimited) && until > now;
  chipCooldown.hidden = !inCooldown;
  if (inCooldown) {
    const sec = Math.max(0, Math.floor((until - now) / 1000));
    const mm = Math.floor(sec / 60);
    const ss = sec % 60;
    chipCooldown.querySelector(".value").textContent = `${mm}:${String(ss).padStart(2, "0")}`;
    chipCooldown.classList.add("warn");
    chipCooldown.title = `Rate limit cooldown until ${new Date(until).toLocaleTimeString()}`;
  }
}

function densityLabel(d) {
  return d === "compact" ? "Comfortable" : "Compact";
}

function updateDensityToggle() {
  const btnComfort = document.getElementById("densityComfortable");
  const btnCompact = document.getElementById("densityCompact");
  const btnUltra = document.getElementById("densityUltra");
  if (!btnComfort || !btnCompact || !btnUltra) return;
  const d = String(settings?.density || "comfortable");
  btnComfort.classList.toggle("active", d === "comfortable");
  btnCompact.classList.toggle("active", d === "compact");
  btnUltra.classList.toggle("active", d === "ultra");
}

async function load() {
  settings = { ...DEFAULTS, ...(await window.api.getSettings()) };
  window.__applyTheme?.(settings);
  applyFocusMode(isFocusMode());
  usernamesState = uniqUsernames(settings.usernames);
  state = await window.api.getState();
  try {
    const jt = await window.api.getJoinTrackerState();
    joinTrackerState = jt || null;
    watchUsersState = uniqUsernames(jt?.watchUsers || []);
  } catch {
    watchUsersState = [];
  }
  renderStatus();
  const h = await window.api.getHistory();
  historyAll = Array.isArray(h) ? h : [];
  try {
    const ns = await window.api.getNotificationsState();
    notifLastReadAt = Number(ns?.lastReadAt || 0) || 0;
  } catch (err) {
    notifLastReadAt = 0;
    setStatus('A full restart is required (Exit from tray → "npm start") to enable the new notifications.');
  }
  renderNotifications();
  setNotifCount(computeUnreadCount());
  renderHealth();
  renderHealthBadges();
  renderActivity();
  renderGiftsCard();
  renderCharts();
  renderKPIs();
  updateDensityToggle();
}

document.getElementById("checkNow").addEventListener("click", async () => {
  const btn = document.getElementById("checkNow");
  const subtitle = document.getElementById("subtitle");
  const prevText = btn.textContent;
  btn.classList.add("loading");
  btn.disabled = true;
  btn.textContent = "Checking…";
  subtitle.textContent = "Checking…";
  document.body.classList.add("checking");
  try {
    await window.api.runCheck();
  } finally {
    btn.classList.remove("loading");
    btn.disabled = false;
    btn.textContent = prevText;
    subtitle.textContent = "Status service";
    document.body.classList.remove("checking");
  }
});

function setAppMenuOpen(open) {
  const pop = document.getElementById("appMenu");
  const btn = document.getElementById("appMenuBtn");
  if (!pop || !btn) return;
  pop.hidden = !open;
  btn.setAttribute("aria-expanded", open ? "true" : "false");
}

function isAppMenuOpen() {
  const pop = document.getElementById("appMenu");
  return pop ? !pop.hidden : false;
}

document.getElementById("appMenuBtn").addEventListener("click", (e) => {
  e.stopPropagation();
  setAppMenuOpen(!isAppMenuOpen());
});

document.addEventListener("click", (e) => {
  if (!isAppMenuOpen()) return;
  const pop = document.getElementById("appMenu");
  const btn = document.getElementById("appMenuBtn");
  if (!pop || !btn) return;
  if (pop.contains(e.target) || btn.contains(e.target)) return;
  setAppMenuOpen(false);
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    setAppMenuOpen(false);
    setDrawer(false);
    setDetailsOpen(false);
  }
  if (!e.ctrlKey && !e.metaKey && !e.altKey && String(e.key || "").toLowerCase() === "f") {
    const el = document.getElementById("toggleFocus");
    if (document.activeElement && ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) return;
    e.preventDefault();
    applyFocusMode(!isFocusMode());
    toast(isFocusMode() ? "Focus mode: ON" : "Focus mode: OFF");
    el?.blur?.();
  }
});

document.getElementById("appMenu").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-menu]");
  if (!btn) return;
  const key = btn.getAttribute("data-menu");
  setAppMenuOpen(false);

  try {
    if (key === "settings") await window.api.openSettingsPopup();
    else if (key === "history") await window.api.openHistoryPopup();
    else if (key === "join") await window.api.openJoinTrackerPopup(null);
    else if (key === "focus") applyFocusMode(!isFocusMode());
    else if (key === "reload") await window.api.reloadUI();
    else if (key === "devtools") await window.api.toggleDevTools();
    else if (key === "restart") await window.api.restartApp({ clearCache: false });
    else if (key === "clearCacheRestart") await window.api.restartApp({ clearCache: true });
    else if (key === "clearCache") await window.api.clearCache();
  } catch (err) {
    setStatus(`Error: ${String(err?.message || err).slice(0, 120)}`);
  }
});

document.getElementById("densityComfortable").addEventListener("click", async () => {
  try {
    settings = await window.api.setSettings({ ...settings, density: "comfortable" });
    window.__applyTheme?.(settings);
    updateDensityToggle();
  } catch (err) {
    setStatus(`Error: ${String(err?.message || err).slice(0, 80)}`);
  }
});

document.getElementById("densityCompact").addEventListener("click", async () => {
  try {
    settings = await window.api.setSettings({ ...settings, density: "compact" });
    window.__applyTheme?.(settings);
    updateDensityToggle();
  } catch (err) {
    setStatus(`Error: ${String(err?.message || err).slice(0, 80)}`);
  }
});

document.getElementById("densityUltra")?.addEventListener("click", async () => {
  try {
    settings = await window.api.setSettings({ ...settings, density: "ultra" });
    window.__applyTheme?.(settings);
    updateDensityToggle();
  } catch (err) {
    setStatus(`Error: ${String(err?.message || err).slice(0, 80)}`);
  }
});

document.getElementById("toggleFocus")?.addEventListener("click", () => {
  applyFocusMode(!isFocusMode());
  toast(isFocusMode() ? "Focus mode: ON" : "Focus mode: OFF");
});

document.getElementById("openNotifications").addEventListener("click", () => {
  setDrawer(true);
});

document.querySelector(".drawerTabs")?.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-ntab]");
  if (!btn) return;
  notifyTab = btn.getAttribute("data-ntab") || "all";
  renderNotifications();
});

document.getElementById("markAllRead").addEventListener("click", async () => {
  const latestTs = Math.max(0, ...getNotifyEvents("all").map((e) => e?.ts || 0));
  try {
    const res = await window.api.markNotificationsRead(latestTs || Date.now());
    notifLastReadAt = Number(res?.lastReadAt || latestTs || Date.now()) || 0;
    renderNotifications();
    setNotifCount(computeUnreadCount());
  } catch (err) {
    setStatus('Main process is outdated (tray). Exit from tray and start again for "Mark all read" to work.');
  }
});

document.getElementById("markTabRead")?.addEventListener("click", async () => {
  const latestTs = Math.max(0, ...getNotifyEvents(notifyTab).map((e) => e?.ts || 0));
  try {
    const res = await window.api.markNotificationsRead(latestTs || Date.now());
    notifLastReadAt = Number(res?.lastReadAt || latestTs || Date.now()) || 0;
    renderNotifications();
    setNotifCount(computeUnreadCount());
  } catch (err) {
    setStatus('Main process is outdated (tray). Exit from tray and start again for "Mark read" to work.');
  }
});
document.getElementById("closeNotifications").addEventListener("click", () => setDrawer(false));
document.getElementById("drawerOverlay").addEventListener("click", () => setDrawer(false));

document.getElementById("closeDetails").addEventListener("click", () => setDetailsOpen(false));
document.getElementById("detailsOverlay").addEventListener("click", () => setDetailsOpen(false));

document.getElementById("openHistoryFromActivity").addEventListener("click", async () => {
  await window.api.openHistoryPopup();
});
document.getElementById("openNotificationsFromActivity").addEventListener("click", () => {
  setDrawer(true);
});

document.getElementById("openJoinTrackerFromGifts")?.addEventListener("click", async () => {
  await window.api.openJoinTrackerPopup(null);
});

document.getElementById("openGiftNotifications")?.addEventListener("click", () => {
  notifyTab = "gifts";
  setDrawer(true);
});

function buildSuggestions(q) {
  const query = String(q || "").trim().toLowerCase().replace(/^@+/, "");
  if (!query) return [];
  const out = [];
  const seen = new Set();
  for (const u of usernamesState || []) {
    if (!u.includes(query)) continue;
    seen.add(u);
    out.push({ kind: "profile", value: u });
  }
  for (const w of watchUsersState || []) {
    if (seen.has(w)) continue;
    if (!w.includes(query)) continue;
    out.push({ kind: "watch", value: w });
  }
  return out;
}

function hideTopSuggest() {
  const pop = document.getElementById("topSuggest");
  if (!pop) return;
  pop.hidden = true;
  pop.innerHTML = "";
}

function showTopSuggest(items, q) {
  const pop = document.getElementById("topSuggest");
  if (!pop) return;
  const query = String(q || "").trim().toLowerCase().replace(/^@+/, "");
  if (!query || !items.length) return hideTopSuggest();
  pop.hidden = false;
  pop.innerHTML = items
    .slice(0, 10)
    .map(
      (x) => `
        <button class="suggestItem" type="button" role="option" data-kind="${x.kind}" data-value="${x.value}">
          <span class="suggestTitle">@${x.value}</span>
          <span class="suggestMeta">${x.kind === "watch" ? "Watching" : "Profile"}</span>
        </button>
      `
    )
    .join("");
}

document.getElementById("statusSearch").addEventListener("input", (e) => {
  statusSearch = String(e.target.value || "");
  const t = document.getElementById("topSearch");
  if (t && t.value !== statusSearch) t.value = statusSearch;
  showTopSuggest(buildSuggestions(statusSearch), statusSearch);
  renderStatus();
});

document.getElementById("topSearch").addEventListener("input", (e) => {
  statusSearch = String(e.target.value || "");
  const s = document.getElementById("statusSearch");
  if (s && s.value !== statusSearch) s.value = statusSearch;
  showTopSuggest(buildSuggestions(statusSearch), statusSearch);
  renderStatus();
});

document.getElementById("topSearch")?.addEventListener("keydown", (e) => {
  if (e.key === "Escape") hideTopSuggest();
  if (e.key === "Enter") {
    const pop = document.getElementById("topSuggest");
    const first = pop?.querySelector(".suggestItem");
    if (first) {
      e.preventDefault();
      first.click();
    }
  }
});

document.getElementById("topSuggest")?.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-value]");
  if (!btn) return;
  const u = btn.getAttribute("data-value");
  if (!u) return;
  const top = document.getElementById("topSearch");
  const s = document.getElementById("statusSearch");
  if (top) top.value = `@${u}`;
  if (s) s.value = `@${u}`;
  statusSearch = `@${u}`;
  hideTopSuggest();
  renderStatus();
  openDetails(u);
});

document.addEventListener("click", (e) => {
  const pop = document.getElementById("topSuggest");
  const top = document.getElementById("topSearch");
  if (!pop || !top) return;
  if (pop.hidden) return;
  if (pop.contains(e.target) || top.contains(e.target)) return;
  hideTopSuggest();
});

document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === "k") {
    const t = document.getElementById("topSearch");
    if (t) {
      e.preventDefault();
      t.focus();
      t.select?.();
    }
  }
});

let motionEl = null;
let motionRaf = 0;
document.addEventListener("pointermove", (e) => {
  if (prefersReducedMotion()) return;
  const el = e.target?.closest?.(".card, .kanbanCard, .activityItem, .notifyItem, .chartRow");
  if (!el) return;
  if (motionEl !== el) {
    if (motionEl) {
      motionEl.classList.remove("spotlight", "isHot");
    }
    motionEl = el;
    motionEl.classList.add("spotlight", "isHot");
  }

  if (motionRaf) cancelAnimationFrame(motionRaf);
  motionRaf = requestAnimationFrame(() => {
    if (!motionEl) return;
    const r = motionEl.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    const mx = `${Math.round(px * 100)}%`;
    const my = `${Math.round(py * 100)}%`;
    motionEl.style.setProperty("--mx", mx);
    motionEl.style.setProperty("--my", my);
  });
});

document.addEventListener("pointerout", (e) => {
  if (!motionEl) return;
  const leaving = e.target === motionEl && !motionEl.contains(e.relatedTarget);
  if (!leaving) return;
  motionEl.classList.remove("isHot");
});

document.getElementById("statusSort").addEventListener("change", (e) => {
  statusSort = String(e.target.value || "liveFirst");
  renderStatus();
});

document.getElementById("statusFilter").addEventListener("change", (e) => {
  statusFilter = String(e.target.value || "all");
  renderStatus();
});

document.querySelector(".statusSeg")?.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-sfilter]");
  if (!btn) return;
  const key = btn.getAttribute("data-sfilter") || "all";
  statusFilter = key;
  const fEl = document.getElementById("statusFilter");
  if (fEl) fEl.value = key;
  renderStatus();
});

window.api.onStateUpdated((s) => {
  state = s || { byUser: {} };
  renderStatus();
  renderHealth();
  renderHealthBadges();
});

window.api.onSettingsUpdated((s) => {
  settings = { ...DEFAULTS, ...(s || {}) };
  window.__applyTheme?.(settings);
  usernamesState = uniqUsernames(settings.usernames);
  renderStatus();
  renderHealth();
  renderCharts();
  updateDensityToggle();
});

window.api.onHistoryUpdated((h) => {
  historyAll = Array.isArray(h) ? h : [];
  renderNotifications();
  setNotifCount(computeUnreadCount());
  renderActivity();
  renderGiftsCard();
  renderCharts();
  renderKPIs();
});

window.api.onJoinTrackerUpdated((payload) => {
  joinTrackerState = payload || joinTrackerState;
  if (Array.isArray(payload?.watchUsers)) watchUsersState = uniqUsernames(payload.watchUsers);
  renderKPIs();
});

window.api.onNotificationsStateUpdated((s) => {
  notifLastReadAt = Number(s?.lastReadAt || 0) || 0;
  renderNotifications();
  setNotifCount(computeUnreadCount());
});

function renderAppBanner() {
  const banner = document.getElementById("appBanner");
  if (!banner) return;
  if (!appStatus) {
    banner.hidden = true;
    return;
  }

  const now = Date.now();
  const parts = [];
  if (appStatus.rateLimited && appStatus.rateLimitedUntil) {
    parts.push(`Rate limit cooldown until ${new Date(appStatus.rateLimitedUntil).toLocaleTimeString()}`);
  }
  if (appStatus.statusThrottled && appStatus.statusThrottledUntil) {
    parts.push(
      `Status checks are throttled until ${new Date(appStatus.statusThrottledUntil).toLocaleTimeString()} (Join Tracker: All LIVE)`
    );
  }
  if (!parts.length) {
    banner.hidden = true;
    return;
  }

  banner.textContent = parts.join(" • ");
  banner.hidden = false;
}

window.api.onAppStatusUpdated((s) => {
  appStatus = s || null;
  renderAppBanner();
  renderHealth();
  renderHealthBadges();
});

window.api.getAppStatus().then((s) => {
  appStatus = s || null;
  renderAppBanner();
  renderHealth();
  renderHealthBadges();
});

setInterval(() => {
  if (appStatus) renderHealthBadges();
}, 1000);

load();
initDashCollapsibles();

