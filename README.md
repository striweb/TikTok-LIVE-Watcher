## TikTok LIVE Watcher — Electron app (Windows / macOS / Linux)

Tray приложение (Electron), което следи TikTok LIVE статус **през `tiktok-chat-reader.zerody.one` (Zerody backend)** и показва desktop нотификации при `offline → LIVE`.

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

### Стартиране (dev)

В папка `tiktok-live-watcher-electron`:

```bash
npm install
npm start
```

> Забележка: `node_modules/` НЕ се качва в GitHub. След clone — `npm install`.

### Build / инсталационен файл (.app/.dmg за macOS)

На Mac, в папка `tiktok-live-watcher-electron`:

```bash
npm install
npm run dist:mac
```

Артефактите излизат в `dist/` (обикновено `.dmg` + `.zip`/`.app`).

#### Важно (macOS Gatekeeper)

Без Apple signing/notarization macOS може да покаже предупреждение при първо стартиране. Това е нормално за unsigned приложения.
Ако искаш да няма предупреждения, можем да добавим подписване/нотаризация (изисква Apple Developer акаунт).

### Как се ползва

- Приложението остава активно в tray (затваряне на прозореца го скрива).
- Double-click на tray иконата → отваря прозореца.
- “Провери сега” → ръчна проверка.
- “Отвори” → отваря `obs.html` overlay линка за даден username.

### Настройки

- **Usernames**: CRUD списък (добави/редактирай/изтрий) → “Запази”
- **Интервал**: 1–60 мин
- **OBS params**: параметрите за твоя Zerody overlay URL (след `username=...&`)
- **Auto Track All LIVE**: always-on следене на joins/gifts за всички LIVE (rotation)
- **Gift tracking**: log + (optional) desktop notify + cooldown

### Бележки / ограничения

- Ако Zerody backend има временни проблеми или rate limit, някои users може да покажат `unknown` (reason/err се виждат в UI).
- Нотификация се показва **само при старт на LIVE** (offline → LIVE).
- “All LIVE” tracking е rotation (един host активен в момента), за да пазим Zerody rate limit.

