/**
 * Helpers for the print-preview window.
 *
 * Flow:
 *   1. Renderer triggers `noterDesktop.openPrintPreview(noteId)`.
 *   2. Main calls webContents.printToPDF on the source window with safe
 *      options (round 9 validator).
 *   3. We construct a new lightweight BrowserWindow that loads a tiny
 *      HTML wrapper showing the PDF inline with "Print" / "Cancel" buttons.
 *   4. The wrapper's "Print" button posts back to main, which triggers
 *      webContents.print on the source window (NOT the preview).
 *
 * This module owns pure helpers: building the preview HTML and computing
 * preview-window options. The actual lifecycle stays in main.js.
 */

const PREVIEW_MAX_BYTES = 30 * 1024 * 1024; // 30 MB cap; previews larger than this are unwieldy.

const buildPreviewHtml = ({ dataUrl, title, bytes }) => {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:application/pdf')) {
    throw new Error('previewHtml: dataUrl must be application/pdf');
  }
  if (bytes && bytes > PREVIEW_MAX_BYTES) {
    throw new Error(`previewHtml: PDF is ${bytes} bytes (max ${PREVIEW_MAX_BYTES})`);
  }
  const safeTitle = typeof title === 'string' ? title.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])) : 'Print preview';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; object-src data:; script-src 'unsafe-inline'; style-src 'unsafe-inline';">
  <title>${safeTitle}</title>
  <style>
    html, body { margin: 0; padding: 0; height: 100%; background: #1c1b1f; color: #e6e1e5; font-family: system-ui, -apple-system, sans-serif; }
    header { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: #2b2930; }
    header h1 { font-size: 14px; margin: 0; flex: 1; font-weight: 500; }
    button { background: #d0bcff; color: #381e72; border: 0; border-radius: 9999px; padding: 6px 14px; font-size: 13px; cursor: pointer; }
    button.secondary { background: transparent; color: #cac4d0; border: 1px solid #49454f; }
    main { height: calc(100% - 48px); }
    object, embed { width: 100%; height: 100%; }
  </style>
</head>
<body>
  <header>
    <h1>${safeTitle}</h1>
    <button class="secondary" id="cancel">Close</button>
    <button id="print">Print</button>
  </header>
  <main>
    <object data="${dataUrl}" type="application/pdf"></object>
  </main>
  <script>
    document.getElementById('print').addEventListener('click', () => { window.postMessage({ kind: 'print' }, '*'); });
    document.getElementById('cancel').addEventListener('click', () => { window.postMessage({ kind: 'cancel' }, '*'); });
  </script>
</body>
</html>`;
};

const previewWindowOptions = ({ parentBounds } = {}) => ({
  width: 720,
  height: 900,
  show: false,
  title: 'Print Preview',
  resizable: true,
  parent: undefined,
  modal: false,
  webPreferences: {
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    // No preload — the preview is a static HTML page that needs no IPC.
  },
  ...(parentBounds ? { x: Math.round(parentBounds.x + 40), y: Math.round(parentBounds.y + 40) } : {}),
});

module.exports = { buildPreviewHtml, previewWindowOptions, PREVIEW_MAX_BYTES };
