let lastSettings = null;

function resolveThemeMode(mode) {
  const m = String(mode || "system");
  if (m === "dark" || m === "light") return m;
  try {
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "dark";
  }
}

function ensureSystemThemeListener() {
  if (window.__systemThemeListenerReady) return;
  window.__systemThemeListenerReady = true;
  try {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (!lastSettings) return;
      if (String(lastSettings.themeMode || "system") !== "system") return;
      applyTheme(lastSettings);
    };
    if (mq && typeof mq.addEventListener === "function") mq.addEventListener("change", onChange);
    else if (mq && typeof mq.addListener === "function") mq.addListener(onChange);
  } catch {}
}

function applyTheme(settings) {
  lastSettings = settings || {};
  const mode = String(settings?.themeMode || "system");
  const theme = resolveThemeMode(mode);
  const accent = String(settings?.accent || "violet");
  const density = String(settings?.density || "comfortable");
  const dark = String(settings?.darkVariant || "midnight");
  const layout = String(settings?.dashboardLayout || "default");

  document.documentElement.dataset.themeMode = mode;
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.accent = accent;
  document.documentElement.dataset.density = density;
  document.documentElement.dataset.dark = dark;
  document.documentElement.dataset.layout = layout;

  ensureSystemThemeListener();
}

window.__applyTheme = applyTheme;

