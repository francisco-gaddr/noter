/**
 * Vibrancy / NSVisualEffectView selection for the main window.
 *
 * macOS: `vibrancy` accepts a named material. We pick based on the
 * resolved theme (light/dark) AND the platform version — vibrancy
 * material names changed in macOS 10.14 and later.
 *
 * Pure function — returns the option value (or null) without touching
 * BrowserWindow. Caller passes the result into the constructor or
 * to win.setVibrancy().
 *
 * Windows 11 has setBackgroundMaterial (handled separately in main.js);
 * vibrancy here means "macOS only".
 */

const MAC_VIBRANCY_MATERIALS = new Set([
  // Pre-macOS 10.14 (deprecated but still valid)
  'light', 'dark', 'medium-light', 'ultra-dark',
  'titlebar', 'selection', 'menu', 'popover',
  'sidebar', 'header', 'sheet', 'window',
  'hud', 'fullscreen-ui', 'tooltip', 'content',
  'under-window', 'under-page',
  // 10.14+ semantic materials
  'appearance-based',
]);

const resolveVibrancyForTheme = (theme, platform = process.platform) => {
  if (platform !== 'darwin') return null;
  // 'sidebar' picks up the system tint nicely on both light and dark;
  // 'under-window' is for transparent main backgrounds — too aggressive
  // for our renderer which already paints a surface color.
  if (theme === 'dark') return 'dark';
  return 'sidebar';
};

const isValidVibrancyMaterial = (m) => typeof m === 'string' && MAC_VIBRANCY_MATERIALS.has(m);

module.exports = {
  resolveVibrancyForTheme,
  isValidVibrancyMaterial,
  MAC_VIBRANCY_MATERIALS: Array.from(MAC_VIBRANCY_MATERIALS),
};
