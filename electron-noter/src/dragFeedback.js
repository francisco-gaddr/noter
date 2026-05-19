/**
 * CSS payload + helper for the drag-target highlight overlay.
 *
 * The renderer's drop handler fires before our main-side validator gets
 * the file path, so users would otherwise see no immediate feedback that
 * the drop will be accepted. We inject a small CSS class
 * `noter-drag-target` that the renderer applies to its drop zone on
 * `dragenter` and removes on `dragleave`/`drop`.
 *
 * Why inject CSS via webContents vs shipping it in the renderer bundle:
 *   - The renderer is fed from web/electron-noter/renderer/ which is a
 *     prebuilt bundle. Modifying it requires a rebuild; injection lets
 *     us evolve the feedback styling at the Electron-shell layer
 *     without re-shipping web.
 *
 * The CSS is intentionally narrow: only `.noter-drag-target` rules are
 * injected so we don't fight the renderer's own styles.
 */

const DRAG_FEEDBACK_CSS = `
.noter-drag-target {
  position: relative;
  outline: 2px dashed var(--noter-primary, #6750A4);
  outline-offset: -8px;
  background-color: color-mix(in srgb, var(--noter-primary, #6750A4) 6%, transparent);
  transition: outline-color 120ms ease, background-color 120ms ease;
}
.noter-drag-target.is-rejected {
  outline-color: var(--noter-error, #B3261E);
  background-color: color-mix(in srgb, var(--noter-error, #B3261E) 8%, transparent);
}
@media (prefers-reduced-motion: reduce) {
  .noter-drag-target { transition: none; }
}
`;

/**
 * Returns the CSS string. Exposed for tests + so callers can inject via
 * webContents.insertCSS at controlled points (e.g., right after did-finish-load).
 */
const getDragFeedbackCss = () => DRAG_FEEDBACK_CSS;

module.exports = {
  getDragFeedbackCss,
  DRAG_FEEDBACK_CSS,
};
