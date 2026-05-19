/**
 * Window-state persistence helpers. Pure functions kept here so we can
 * unit-test the validation logic without needing the screen module.
 */

const DEFAULTS = {
  width: 1280,
  height: 800,
  x: undefined,
  y: undefined,
};

/**
 * Validate a stored window-state object against the supplied display list.
 * Returns the state when sane, or defaults otherwise.
 *
 * Sanity checks:
 *  - width/height within [320, 8000] (we won't restore a 1px window)
 *  - if x/y supplied, they must fall within at least one display's work area
 *    so we never restore off-screen (multi-monitor user unplugs external screen)
 *
 * `displays` is the array returned by screen.getAllDisplays(); each entry must
 * have `workArea: { x, y, width, height }`.
 */
const validateWindowState = (state, displays) => {
  if (!state || typeof state !== 'object') return { ...DEFAULTS };

  const width = Number(state.width);
  const height = Number(state.height);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return { ...DEFAULTS };
  if (width < 320 || height < 240 || width > 8000 || height > 8000) return { ...DEFAULTS };

  let x = Number(state.x);
  let y = Number(state.y);
  const hasPos = Number.isFinite(x) && Number.isFinite(y);

  if (hasPos && Array.isArray(displays) && displays.length > 0) {
    const fits = displays.some((d) => {
      const wa = d && d.workArea;
      if (!wa) return false;
      // The window must overlap the display by at least 50px in each axis so
      // it's draggable back into view.
      const overlapsX = x + width > wa.x + 50 && x < wa.x + wa.width - 50;
      const overlapsY = y + height > wa.y + 50 && y < wa.y + wa.height - 50;
      return overlapsX && overlapsY;
    });
    if (!fits) {
      x = undefined;
      y = undefined;
    }
  }

  return {
    width,
    height,
    ...(Number.isFinite(x) ? { x } : {}),
    ...(Number.isFinite(y) ? { y } : {}),
    isMaximized: Boolean(state.isMaximized),
  };
};

const captureWindowState = (win) => {
  if (!win || win.isDestroyed && win.isDestroyed()) return null;
  try {
    const bounds = win.getNormalBounds ? win.getNormalBounds() : win.getBounds();
    return {
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      isMaximized: typeof win.isMaximized === 'function' ? win.isMaximized() : false,
    };
  } catch {
    return null;
  }
};

module.exports = { validateWindowState, captureWindowState, DEFAULTS };
