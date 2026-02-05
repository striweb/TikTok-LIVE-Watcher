function applyTheme(settings) {
  const mode = String(settings?.themeMode || "system");
  const accent = String(settings?.accent || "violet");
  const density = String(settings?.density || "comfortable");
  const dark = String(settings?.darkVariant || "midnight");

  document.documentElement.dataset.theme = mode;
  document.documentElement.dataset.accent = accent;
  document.documentElement.dataset.density = density;
  document.documentElement.dataset.dark = dark;
}

window.__applyTheme = applyTheme;

