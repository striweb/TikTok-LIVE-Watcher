function applyTheme(settings) {
  const mode = String(settings?.themeMode || "system");
  const accent = String(settings?.accent || "violet");
  const density = String(settings?.density || "comfortable");

  document.documentElement.dataset.theme = mode;
  document.documentElement.dataset.accent = accent;
  document.documentElement.dataset.density = density;
}

window.__applyTheme = applyTheme;

