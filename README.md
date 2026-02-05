## TikTok LIVE Watcher — Electron app (Windows / macOS / Linux)

Tray app (Electron) that monitors TikTok LIVE status **via `tiktok-chat-reader.zerody.one` (Zerody backend)** and shows desktop notifications on `offline → LIVE`.

### Features

- Dashboard (Table / Kanban)
- Profiles CRUD + global interval + per-host interval policy
- LIVE / Unknown / Offline statuses + roomId + errors + “last live seen”
- History + Export CSV
- Notifications drawer (tabs: LIVE / Joins / Gifts / Warnings) + unread state + “Mark all read”
- Join Tracker (single host / All LIVE rotation)
- Gift tracking for watched viewers (shows host + time + gift summary)
- Auto Track All LIVE (always-on join/gift tracking via rotation)
- Themes (System / Light / Dark) + Accent colors + Density toggle
- Maintenance: Restart / Clear cache / Factory reset

### Run (dev)

In `tiktok-live-watcher-electron/`:

```bash
npm install
npm start
```

> Note: `node_modules/` is NOT committed to GitHub. After cloning, run `npm install`.

### Build / installers (macOS `.app` / `.dmg`)

On macOS, in `tiktok-live-watcher-electron/`:

```bash
npm install
npm run dist:mac
```

Artifacts are produced in `dist/` (usually `.dmg` + `.zip`/`.app`).

#### macOS Gatekeeper

Without Apple signing/notarization, macOS may warn on first run. This is normal for unsigned apps.
If you want no warnings, add signing/notarization (requires an Apple Developer account).

### Usage

- The app stays active in the tray (closing the window hides it).
- Double-click the tray icon to open the window.
- “Check now” triggers a manual check.
- “Open/Overlay” opens the `obs.html` overlay for a username.

### Settings

- **Usernames**: CRUD list (add/edit/delete) → Save
- **Interval**: 1–60 minutes
- **OBS params**: parameters for your Zerody overlay URL (after `username=...&`)
- **Auto Track All LIVE**: always-on joins/gifts tracking for all LIVE (rotation)
- **Gift tracking**: log + (optional) desktop notify + cooldown

### Notes / limitations

- If Zerody has issues or you hit rate limits, some users may show `unknown` (reason/error is shown in the UI).
- The LIVE notification is shown **only on LIVE start** (offline → LIVE).
- “All LIVE” tracking is a rotation (one host active at a time) to reduce Zerody rate limits.

