import React, { useEffect, useMemo, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable
} from "@tanstack/react-table";

function resolveThemeMode(mode) {
  const m = String(mode || "system");
  if (m === "dark" || m === "light") return m;
  try {
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "dark";
  }
}

function applyTheme(settings) {
  const mode = String(settings?.themeMode || "system");
  const theme = resolveThemeMode(mode);
  const accent = String(settings?.accent || "violet");
  const density = String(settings?.density || "comfortable");
  const dark = String(settings?.darkVariant || "midnight");
  const layout = String(settings?.dashboardLayout || "default");
  const pack = String(settings?.themePack || "default");

  document.documentElement.dataset.themeMode = mode;
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.accent = accent;
  document.documentElement.dataset.density = density;
  document.documentElement.dataset.dark = dark;
  document.documentElement.dataset.layout = layout;
  document.documentElement.dataset.pack = pack;
}

function normalizeUsername(u) {
  return String(u || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
}

function avatarLetter(username) {
  const u = String(username || "").trim().replace(/^@+/, "");
  return (u[0] || "?").toUpperCase();
}

function hashHue(s) {
  const str = String(s || "");
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

function avatarStyle(username) {
  const hue = hashHue(username);
  return {
    "--av": `linear-gradient(135deg, hsla(${hue}, 85%, 60%, 0.95), hsla(${(hue + 38) % 360}, 85%, 58%, 0.85))`
  };
}

function formatTime(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
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

function pill(isLive) {
  if (isLive === true) return { text: "LIVE", cls: "live" };
  if (isLive === false) return { text: "offline", cls: "offline" };
  return { text: "unknown", cls: "unknown" };
}

export default function App() {
  const [settings, setSettings] = useState(null);
  const [state, setState] = useState({ byUser: {} });
  const [globalFilter, setGlobalFilter] = useState("");

  useEffect(() => {
    let offSettings = null;
    let offState = null;
    (async () => {
      const s = await window.api.getSettings();
      setSettings(s || null);
      applyTheme(s || {});
      const st = await window.api.getState();
      setState(st || { byUser: {} });

      offSettings = window.api.onSettingsUpdated((ns) => {
        setSettings(ns || null);
        applyTheme(ns || {});
      });
      offState = window.api.onStateUpdated((nst) => setState(nst || { byUser: {} }));
    })();
    return () => {
      try {
        offSettings?.();
        offState?.();
      } catch {}
    };
  }, []);

  const usernames = useMemo(() => {
    const list = Array.isArray(settings?.usernames) ? settings.usernames : [];
    return list.map(normalizeUsername).filter(Boolean);
  }, [settings]);

  const rows = useMemo(() => {
    const byUser = state?.byUser || {};
    return usernames.map((u) => {
      const st = byUser[u] || { username: u, isLive: null, confidence: "low" };
      return {
        username: u,
        status: st.isLive,
        liveFor: st.isLive === true ? formatDurationSince(st.lastChangeAt) : st.lastLiveSeenAt ? `Last: ${formatDurationSince(st.lastLiveSeenAt)}` : "—",
        checkedAt: st.checkedAt || 0,
        checked: formatTime(st.checkedAt),
        confidence: st.confidence || "—",
        roomId: st.roomId ? String(st.roomId) : "",
        viewers: Number.isFinite(Number(st.viewerCount)) ? Math.round(Number(st.viewerCount)) : null,
        lastError: st.ok === false ? String(st.error || st.reason || "error") : ""
      };
    });
  }, [usernames, state]);

  const columns = useMemo(
    () => [
      {
        header: "Profile",
        accessorKey: "username",
        cell: (info) => {
          const u = info.getValue();
          return (
            <div className="profileCell">
              <span className="avatar" style={avatarStyle(u)} aria-hidden="true">
                {avatarLetter(u)}
              </span>
              <b>@{u}</b>
            </div>
          );
        }
      },
      {
        header: "Status",
        accessorKey: "status",
        cell: (info) => {
          const p = pill(info.getValue());
          return (
            <span className={`pill ${p.cls}`} style={{ cursor: "default" }}>
              {p.text}
            </span>
          );
        }
      },
      { header: "LIVE", accessorKey: "liveFor" },
      { header: "Check", accessorKey: "checked" },
      { header: "Confidence", accessorKey: "confidence" },
      {
        header: "Room",
        accessorKey: "roomId",
        cell: (info) => {
          const v = info.getValue();
          return v ? <span className="mono muted">{v}</span> : <span className="mono muted">—</span>;
        }
      },
      {
        header: "Viewers",
        accessorKey: "viewers",
        cell: (info) => {
          const v = info.getValue();
          return v == null ? <span className="mono muted">—</span> : <span className="mono muted">{v}</span>;
        }
      },
      {
        header: "Last error",
        accessorKey: "lastError",
        cell: (info) => {
          const v = info.getValue();
          return v ? <span className="muted truncate">!</span> : <span className="muted">—</span>;
        }
      },
      {
        header: "Actions",
        id: "actions",
        cell: (info) => {
          const u = info.row.original.username;
          return (
            <div className="statusActions">
              <button className="iconBtn" type="button" title="Chat" onClick={() => window.api.openChatPopup(u)}>
                <svg viewBox="0 0 24 24" fill="none" strokeWidth="2">
                  <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"></path>
                </svg>
              </button>
              <button className="iconBtn" type="button" title="Join Tracker" onClick={() => window.api.openJoinTrackerPopup(u)}>
                <svg viewBox="0 0 24 24" fill="none" strokeWidth="2">
                  <circle cx="12" cy="7" r="3"></circle>
                  <path d="M5.5 21a6.5 6.5 0 0 1 13 0"></path>
                  <path d="M19 8v6"></path>
                  <path d="M22 11h-6"></path>
                </svg>
              </button>
              <button className="iconBtn" type="button" title="Overlay" onClick={() => window.api.openOverlay(u)}>
                <svg viewBox="0 0 24 24" fill="none" strokeWidth="2">
                  <path d="M14 3h7v7"></path>
                  <path d="M10 14L21 3"></path>
                  <path d="M21 14v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h6"></path>
                </svg>
              </button>
            </div>
          );
        }
      }
    ],
    []
  );

  const table = useReactTable({
    data: rows,
    columns,
    state: { globalFilter },
    onGlobalFilterChange: setGlobalFilter,
    globalFilterFn: (row, columnId, filterValue) => {
      const q = String(filterValue || "").trim().toLowerCase().replace(/^@+/, "");
      if (!q) return true;
      const u = String(row.original.username || "");
      return u.includes(q);
    },
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel()
  });

  const liveCount = useMemo(() => Object.values(state?.byUser || {}).filter((x) => x?.isLive === true).length, [state]);
  const unknownCount = useMemo(() => Object.values(state?.byUser || {}).filter((x) => x?.isLive == null).length, [state]);

  return (
    <>
      <header className="topbar">
        <div className="topbarLeft">
          <div className="titleRow">
            <div className="logo" aria-hidden="true"></div>
            <div>
              <div className="title">TikTok LIVE Watcher</div>
              <div className="sub">React UI (beta)</div>
            </div>
          </div>
        </div>
        <div className="topbarCenter">
          <div className="topSearchWrap">
            <span className="topSearchIcon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" strokeWidth="2">
                <circle cx="11" cy="11" r="7"></circle>
                <path d="M20 20l-3.5-3.5"></path>
              </svg>
            </span>
            <input
              className="topSearch"
              type="text"
              spellCheck="false"
              placeholder="Search profiles…"
              value={globalFilter}
              onChange={(e) => setGlobalFilter(e.target.value)}
            />
          </div>
        </div>
        <div className="topbarRight">
          <div className="badges">
            <span className={`badge ${liveCount ? "live" : ""}`} title="LIVE profiles">
              <span className="dot"></span>
              <span className="label">LIVE</span>
              <span className="value mono">{liveCount}</span>
            </span>
            <span className={`badge ${unknownCount ? "warn" : ""}`} title="Unknown profiles">
              <span className="dot"></span>
              <span className="label">Unknown</span>
              <span className="value mono">{unknownCount}</span>
            </span>
          </div>
          <button className="btn ghost" type="button" onClick={() => window.api.openSettingsPopup()}>
            Settings
          </button>
          <button className="btn ghost" type="button" onClick={() => window.api.openHistoryPopup()}>
            History
          </button>
          <button className="btn ghost" type="button" onClick={() => window.api.openJoinTrackerPopup(null)}>
            Join Tracker
          </button>
          <button className="btn primary" type="button" onClick={() => window.api.runCheck()}>
            Check now
          </button>
        </div>
      </header>

      <main className="container">
        <section className="card">
          <div className="cardHeader">
            <div>
              <div className="h3">Status</div>
              <div className="muted">TanStack Table (beta).</div>
            </div>
          </div>

          <div className="statusList table">
            <div className="tableHeader">
              {table.getHeaderGroups().map((hg) =>
                hg.headers.map((h) => (
                  <div
                    key={h.id}
                    style={{ cursor: h.column.getCanSort() ? "pointer" : "default" }}
                    onClick={h.column.getToggleSortingHandler()}
                    title={h.column.getCanSort() ? "Sort" : ""}
                  >
                    {flexRender(h.column.columnDef.header, h.getContext())}
                  </div>
                ))
              )}
            </div>
            {table.getRowModel().rows.map((r) => (
              <div key={r.id} className="statusRow animIn">
                {r.getVisibleCells().map((c) => (
                  <div key={c.id}>{flexRender(c.column.columnDef.cell, c.getContext())}</div>
                ))}
              </div>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}

