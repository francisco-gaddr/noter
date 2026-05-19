/**
 * Validator for print/printToPDF options.
 *
 * webContents.print accepts a sprawling options object — if we pass through
 * whatever the renderer sends, a malicious page could DoS us by requesting
 * 1000 copies on tray "manual" with custom margins. This validator caps
 * everything to safe ranges before we hand to Electron.
 */

const ALLOWED_PAGE_SIZES = new Set([
  'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6',
  'Legal', 'Letter', 'Tabloid',
]);

const validatePrintOptions = (raw, opts = {}) => {
  const isPdf = opts.kind === 'pdf';
  const safe = {};

  // Common across print + printToPDF
  if (typeof raw === 'object' && raw !== null) {
    safe.landscape = raw.landscape === true;

    if (typeof raw.pageSize === 'string' && ALLOWED_PAGE_SIZES.has(raw.pageSize)) {
      safe.pageSize = raw.pageSize;
    } else if (raw.pageSize && typeof raw.pageSize === 'object') {
      // Custom size in microns; cap to A0 (841×1189 mm = 841000×1189000 µm)
      const w = Number(raw.pageSize.width);
      const h = Number(raw.pageSize.height);
      if (Number.isFinite(w) && Number.isFinite(h) && w >= 1000 && h >= 1000 && w <= 2_000_000 && h <= 2_000_000) {
        safe.pageSize = { width: Math.floor(w), height: Math.floor(h) };
      } else {
        safe.pageSize = 'A4';
      }
    } else {
      safe.pageSize = 'A4';
    }

    // Margins (printToPDF accepts an object; print accepts a 'margins' key
    // that's a struct on Electron 32+). Bound to 0-50mm.
    if (raw.margins && typeof raw.margins === 'object') {
      const m = raw.margins;
      const clamp = (v, def) => {
        const n = Number(v);
        return Number.isFinite(n) && n >= 0 && n <= 50 ? n : def;
      };
      safe.margins = {
        top: clamp(m.top, 10),
        bottom: clamp(m.bottom, 10),
        left: clamp(m.left, 10),
        right: clamp(m.right, 10),
      };
    }

    safe.printBackground = raw.printBackground === true;
    safe.printSelectionOnly = raw.printSelectionOnly === true;
  }

  if (!isPdf) {
    // print-only options
    safe.silent = raw && raw.silent === true;
    // Copies — Electron caps internally but we add belt+braces here.
    if (raw && Number.isFinite(Number(raw.copies)) && Number(raw.copies) >= 1 && Number(raw.copies) <= 20) {
      safe.copies = Math.floor(Number(raw.copies));
    } else {
      safe.copies = 1;
    }
    if (raw && typeof raw.deviceName === 'string' && raw.deviceName.length > 0 && raw.deviceName.length <= 256) {
      safe.deviceName = raw.deviceName;
    }
  } else {
    // printToPDF-only options
    if (raw && typeof raw.scale === 'number' && raw.scale > 0.1 && raw.scale <= 5) {
      safe.scale = raw.scale;
    }
    safe.preferCSSPageSize = raw && raw.preferCSSPageSize === true;
  }

  return safe;
};

const ALLOWED_PAGE_SIZES_ARRAY = Array.from(ALLOWED_PAGE_SIZES);

module.exports = {
  validatePrintOptions,
  ALLOWED_PAGE_SIZES: ALLOWED_PAGE_SIZES_ARRAY,
};
