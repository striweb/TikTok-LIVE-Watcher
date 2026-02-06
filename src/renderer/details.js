const DEFAULTS = {
  intervalMinutes: 1,
  perHostIntervals: {}
};

function normalizeUsername(u) {
  return String(u || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
}

function formatTime(ts) {
  const n = Number(ts || 0);
  if (!n) return "—";
  try {
    return new Date(n).toLocaleTimeString();
  } catch {
    return "—";
  }
}

function formatDate(ts) {
  const n = Number(ts || 0);
  if (!n) return "—";
  try {
    return new Date(n).toLocaleDateString();
  } catch {
    return "—";
  }
}

function relTime(ts) {
  const n = Number(ts || 0);
  if (!n) return "—";
  const sec = Math.max(0, Math.floor((Date.now() - n) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function formatDuration(ms) {
  const n = Math.max(0, Math.floor(Number(ms || 0)));
  if (!Number.isFinite(n) || n <= 0) return "—";
  const sec = Math.floor(n / 1000);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h <= 0) return `${m}m`;
  return `${h}h ${String(m).padStart(2, "0")}m`;
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

function pill(isLive) {
  if (isLive === true) return { text: "LIVE", cls: "live" };
  if (isLive === false) return { text: "Offline", cls: "offline" };
  return { text: "Unknown", cls: "unknown" };
}

function actionIconSvg(name) {
  const n = String(name || "");
  if (n === "copy")
    return `<svg viewBox="0 0 24 24" fill="none" stroke-width="2"><path d="M8 8h12v12H8z"></path><path d="M4 16H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v1"></path></svg>`;
  if (n === "chat")
    return `<svg viewBox="0 0 24 24" fill="none" stroke-width="2"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"></path></svg>`;
  if (n === "overlay")
    return `<svg viewBox="0 0 24 24" fill="none" stroke-width="2"><path d="M14 3h7v7"></path><path d="M10 14L21 3"></path><path d="M21 14v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h6"></path></svg>`;
  if (n === "join")
    return `<svg viewBox="0 0 24 24" fill="none" stroke-width="2"><circle cx="12" cy="7" r="3"></circle><path d="M5.5 21a6.5 6.5 0 0 1 13 0"></path><path d="M19 8v6"></path><path d="M22 11h-6"></path></svg>`;
  if (n === "history")
    return `<svg viewBox="0 0 24 24" fill="none" stroke-width="2"><path d="M3 3v5h5"></path><path d="M3.05 13a9 9 0 1 0 .5-4.5L3 8"></path><path d="M12 7v6l4 2"></path></svg>`;
  if (n === "bolt")
    return `<svg viewBox="0 0 24 24" fill="none" stroke-width="2"><path d="M13 2L3 14h7l-1 8 12-14h-7l-1-6z"></path></svg>`;
  return `<svg viewBox="0 0 24 24" fill="none" stroke-width="2"><path d="M12 2v20"></path><path d="M2 12h20"></path></svg>`;
}

function eventIconSvg(type) {
  const t = String(type || "");
  if (t === "live_started") return actionIconSvg("bolt");
  if (t === "viewer_joined") return actionIconSvg("join");
  if (t === "gift_sent")
    return `<svg viewBox="0 0 24 24" fill="none" stroke-width="2"><path d="M20 12v10H4V12"></path><path d="M2 7h20v5H2z"></path><path d="M12 22V7"></path><path d="M12 7c-2.5 0-3.5-1.5-3.5-3S10 1 12 3c2-2 3.5 0 3.5 1S14.5 7 12 7z"></path></svg>`;
  if (t === "rate_limited" || t === "error")
    return `<svg viewBox="0 0 24 24" fill="none" stroke-width="2"><path d="M12 9v4"></path><path d="M12 17h.01"></path><path d="M10.3 3.3h3.4L21 10.6v3.4L13.7 21h-3.4L3 13.7v-3.4z"></path></svg>`;
  return `<svg viewBox="0 0 24 24" fill="none" stroke-width="2"><path d="M4 6h16"></path><path d="M4 12h16"></path><path d="M4 18h16"></path></svg>`;
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
  }, 2000);
}

async function copyText(text) {
  const t = String(text || "");
  if (!t) return false;
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(t);
      return true;
    }
  } catch {}
  try {
    const ta = document.createElement("textarea");
    ta.value = t;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

let username = "";
let settings = { ...DEFAULTS };
let state = { byUser: {} };
let historyAll = [];

function readUsernameFromQuery() {
  try {
    const u = new URLSearchParams(location.search).get("u");
    return normalizeUsername(u);
  } catch {
    return "";
  }
}

function safeText(s) {
  return String(s ?? "").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function render() {
  const u = username;
  const st = (state?.byUser || {})[u] || { username: u };
  const p = pill(st.isLive);

  document.title = u ? `@${u} — Details` : "Details";
  const sub = document.getElementById("detailsSubtitle");
  if (sub) sub.textContent = u ? `@${u} • ${p.text}` : "Status service";

  const heroCard = document.getElementById("detailsHeroCard");
  if (heroCard) {
    const viewers = Number.isFinite(Number(st.viewerCount)) ? Math.round(Number(st.viewerCount)) : "—";
    const nextDue = st.nextDueAt ? `${formatTime(st.nextDueAt)}` : "—";
    const checked = st.checkedAt ? `${relTime(st.checkedAt)} • ${formatTime(st.checkedAt)}` : "—";
    const lastLiveSeen = st.lastLiveSeenAt ? `${formatDate(st.lastLiveSeenAt)} ${formatTime(st.lastLiveSeenAt)}` : "—";
    const liveDuration =
      st.isLive === true && st.lastLiveStartedAt ? formatDuration(Date.now() - Number(st.lastLiveStartedAt || 0)) : "";
    const conf = st.confidence ? String(st.confidence) : "—";

    heroCard.innerHTML = `
      <div class="detailsHero detailsHeroV4 ${p.cls === "live" ? "isLive" : ""}">
        <div class="heroRing ${p.cls}">
          <div class="heroAvatar" style="${avatarStyle(u)}">${avatarLetter(u)}</div>
        </div>
        <div class="heroMain">
          <div class="heroTop">
            <div class="heroUser">@${safeText(u)}</div>
            <span class="pill ${p.cls} heroPill">${p.text}</span>
          </div>
          <div class="heroSub muted">
            ${
              st.isLive === true && liveDuration
                ? `LIVE duration: <span class="mono">${safeText(liveDuration)}</span>`
                : `Last LIVE seen: <span class="mono">${safeText(lastLiveSeen)}</span>`
            }
            <span class="heroSep">•</span>
            Last check: <span class="mono">${safeText(checked)}</span>
            <span class="heroSep">•</span>
            Confidence: <span class="mono">${safeText(conf)}</span>
          </div>
          <div class="heroStats">
            <div class="heroStat heroStatBig">
              <div class="heroK">Viewers</div>
              <div class="heroV mono">${safeText(viewers)}</div>
            </div>
            <div class="heroStat">
              <div class="heroK">Next due</div>
              <div class="heroV mono">${safeText(nextDue)}</div>
            </div>
          </div>
        </div>
        <div class="heroActionsPills">
          <button class="pillBtn" type="button" id="actChat">
            <span class="pillIcon" aria-hidden="true">${actionIconSvg("chat")}</span>Chat
          </button>
          <button class="pillBtn" type="button" id="actOverlay">
            <span class="pillIcon" aria-hidden="true">${actionIconSvg("overlay")}</span>Overlay
          </button>
          <button class="pillBtn" type="button" id="actJoin">
            <span class="pillIcon" aria-hidden="true">${actionIconSvg("join")}</span>Join
          </button>
          <button class="pillBtn ghost" type="button" id="actHistory">
            <span class="pillIcon" aria-hidden="true">${actionIconSvg("history")}</span>History
          </button>
          <button class="pillBtn ghost" type="button" id="actCopy">
            <span class="pillIcon" aria-hidden="true">${actionIconSvg("copy")}</span>Copy
          </button>
        </div>
      </div>
    `;
  }

  const policyBody = document.getElementById("policyCardBody");
  if (policyBody) {
    const globalMin = Math.max(1, Math.min(60, Math.round(Number(settings?.intervalMinutes || 1))));
    const perMap = settings?.perHostIntervals && typeof settings.perHostIntervals === "object" ? settings.perHostIntervals : {};
    const override = Math.round(Number(perMap[u] || 0));
    const overrideText = override ? String(override) : "";
    const effectiveMin = override ? override : globalMin;
    const lastErr = st.ok === false ? String(st.error || st.reason || "error").slice(0, 220) : "";

    policyBody.innerHTML = `
      <div class="detailsGrid detailsGridV3" style="margin:0;">
        <div class="detailsCard">
          <div class="detailsKey">Policy interval</div>
          <div class="detailsVal">
            <div class="policyRow">
              <div class="policyLeft">
                <div class="policyMetaRow mono muted">
                  Global <b class="mono">${globalMin}m</b>
                  <span class="heroSep">•</span>
                  Effective <b class="mono">${effectiveMin}m</b>
                  ${override ? `<span class="heroSep">•</span> Override <b class="mono">${override}m</b>` : ""}
                </div>
                <div class="policyInputWrap">
                  <input id="policyOverride" class="input mono" type="number" min="1" max="60" placeholder="${globalMin}" value="${overrideText}" />
                  <span class="policyUnit mono muted">min</span>
                </div>
                <div class="policyPresets" aria-label="Presets">
                  <button class="presetBtn" type="button" data-set="1">1m</button>
                  <button class="presetBtn" type="button" data-set="2">2m</button>
                  <button class="presetBtn" type="button" data-set="5">5m</button>
                  <button class="presetBtn" type="button" data-set="10">10m</button>
                  <button class="presetBtn" type="button" data-set="15">15m</button>
                  <button class="presetBtn" type="button" data-set="30">30m</button>
                </div>
              </div>
              <div class="policyBtns">
                <button id="policySave" class="btn primary" type="button">Save</button>
                <button id="policyClear" class="btn ghost" type="button">Use global</button>
              </div>
            </div>
            <div class="hint">Tip: empty (or same as global) clears override. Press Enter to save.</div>
          </div>
        </div>
        <div class="detailsCard">
          <div class="detailsKey">Last check</div>
          <div class="detailsVal mono">${st.checkedAt ? `${formatDate(st.checkedAt)} ${formatTime(st.checkedAt)}` : "—"}</div>
        </div>
        <div class="detailsCard">
          <div class="detailsKey">Next due</div>
          <div class="detailsVal mono">${st.nextDueAt ? `${formatDate(st.nextDueAt)} ${formatTime(st.nextDueAt)}` : "—"}</div>
        </div>
        <div class="detailsCard">
          <div class="detailsKey">Last error</div>
          <div class="detailsVal mono">${lastErr ? safeText(lastErr) : "—"}</div>
        </div>
      </div>
    `;

    const input = policyBody.querySelector("#policyOverride");
    const saveBtn = policyBody.querySelector("#policySave");
    const clearBtn = policyBody.querySelector("#policyClear");

    const parseDesired = () => {
      const raw = String(input?.value || "").trim();
      if (!raw) return { mode: "clear", raw, v: 0 };
      const v = Math.round(Number(raw));
      if (!Number.isFinite(v) || v < 1 || v > 60) return { mode: "invalid", raw, v: 0 };
      if (v === globalMin) return { mode: "clear", raw, v };
      return { mode: "set", raw, v };
    };

    const syncPolicyButtons = () => {
      const desired = parseDesired();
      const cur = override || 0;
      const next = desired.mode === "set" ? desired.v : 0;
      if (saveBtn) saveBtn.disabled = desired.mode === "invalid" || next === cur;
      if (clearBtn) clearBtn.disabled = cur === 0;
    };

    policyBody.querySelectorAll("button.presetBtn[data-set]").forEach((b) => {
      b.addEventListener("click", () => {
        const v = Math.round(Number(b.getAttribute("data-set") || 0));
        if (!Number.isFinite(v) || v < 1 || v > 60) return;
        if (input) {
          input.value = String(v);
          input.focus();
          input.dispatchEvent(new Event("input"));
        }
      });
    });

    input?.addEventListener("input", () => syncPolicyButtons());
    input?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (saveBtn && !saveBtn.disabled) saveBtn.click();
      }
    });

    saveBtn?.addEventListener("click", async () => {
      const desired = parseDesired();
      if (desired.mode === "invalid") {
        toast("Invalid interval (1–60).", "bad");
        return;
      }
      const nextMap = { ...(perMap || {}) };
      if (desired.mode === "clear") delete nextMap[u];
      else nextMap[u] = desired.v;

      try {
        settings = await window.api.setSettings({ ...settings, perHostIntervals: nextMap });
        window.__applyTheme?.(settings);
        toast("Policy saved.");
        render();
      } catch (err) {
        toast(`Error: ${String(err?.message || err).slice(0, 80)}`, "bad");
      }
    });

    clearBtn?.addEventListener("click", async () => {
      try {
        const nextMap = { ...(perMap || {}) };
        delete nextMap[u];
        settings = await window.api.setSettings({ ...settings, perHostIntervals: nextMap });
        window.__applyTheme?.(settings);
        toast("Using global policy.");
        render();
      } catch (err) {
        toast(`Error: ${String(err?.message || err).slice(0, 80)}`, "bad");
      }
    });

    syncPolicyButtons();
  }

  const eventsBody = document.getElementById("eventsBody");
  if (eventsBody) {
    const ev = (historyAll || []).filter((e) => normalizeUsername(e?.username) === u).slice(0, 20);
    if (!ev.length) {
      eventsBody.innerHTML = `<div class="emptyState"><div class="emptyTitle">No events</div><div class="emptySub">Nothing recorded for @${safeText(u)} yet.</div></div>`;
    } else {
      eventsBody.innerHTML = `
        <div class="detailsTimeline">
          ${ev
            .map((e) => {
              const when = e?.ts ? `${relTime(e.ts)} • ${formatTime(e.ts)}` : "—";
              const rawType = String(e?.type || "event");
              const t = safeText(rawType);
              const msg = safeText(e?.summary || e?.reason || e?.error || "");
              return `<div class="timelineItem animIn" data-type="${rawType.replace(/"/g, "&quot;")}">
                <div class="timelineIcon" aria-hidden="true">${eventIconSvg(rawType)}</div>
                <div class="timelineBody">
                  <div class="timelineTop"><b>${t}</b> <span class="muted mono">${when}</span></div>
                  <div class="muted">${msg}</div>
                </div>
              </div>`;
            })
            .join("")}
        </div>
      `;
    }
  }

  // Wire hero actions
  document.getElementById("actCopy")?.addEventListener("click", async () => {
    const ok = await copyText(`@${u}`);
    toast(ok ? "Copied @username." : "Copy failed.", ok ? "ok" : "bad");
  });
  document.getElementById("actChat")?.addEventListener("click", async () => await window.api.openChatPopup(u));
  document.getElementById("actOverlay")?.addEventListener("click", async () => await window.api.openOverlay(u));
  document.getElementById("actJoin")?.addEventListener("click", async () => await window.api.openJoinTrackerPopup(u));
  document.getElementById("actHistory")?.addEventListener("click", async () => await window.api.openHistoryPopup());

  // Copy chips (roomId)
  document.querySelectorAll("button[data-copy]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const v = btn.getAttribute("data-copy") || "";
      const ok = await copyText(v);
      toast(ok ? "Copied." : "Copy failed.", ok ? "ok" : "bad");
      if (ok) btn.classList.add("copied");
      setTimeout(() => btn.classList.remove("copied"), 900);
    });
  });
}

async function load() {
  username = readUsernameFromQuery();
  if (!username) username = "";

  settings = { ...DEFAULTS, ...(await window.api.getSettings()) };
  window.__applyTheme?.(settings);
  state = (await window.api.getState()) || { byUser: {} };
  const h = await window.api.getHistory();
  historyAll = Array.isArray(h) ? h : [];
  render();
}

document.getElementById("closeWin")?.addEventListener("click", () => window.close());
document.getElementById("openHistory")?.addEventListener("click", async () => await window.api.openHistoryPopup());

window.api.onSettingsUpdated((s) => {
  settings = { ...DEFAULTS, ...(s || {}) };
  window.__applyTheme?.(settings);
  render();
});
window.api.onStateUpdated((s) => {
  state = s || { byUser: {} };
  render();
});
window.api.onHistoryUpdated((h) => {
  historyAll = Array.isArray(h) ? h : [];
  render();
});

void load();

