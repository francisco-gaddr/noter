/**
 * Mobile document text extraction via a WebView-hosted harness (the platform piece left open
 * since ADR 0006). Two job kinds, both run inside the hidden <PdfExtractorHost/>:
 *   - 'pdf' → pdf.js text extraction from base64 PDF bytes
 *   - 'ocr' → Tesseract.js OCR over a base64 image (no native module — pure WASM in the WebView)
 *
 * This module is the imperative API + job queue; the component does the work and resolves the
 * job. Decoupling lets any service (Nextcloud ingest) await text without owning a WebView.
 * Returns null on any failure (no host, parse error, timeout) so callers degrade gracefully.
 */
export type ExtractKind = 'pdf' | 'ocr' | 'docx' | 'xlsx';

export interface ExtractJob {
  id: number;
  kind: ExtractKind;
  base64: string;
  maxPages: number;
  maxChars: number;
  /** OCR languages, e.g. 'eng+swe'. Ignored for pdf. */
  lang: string;
  resolve: (text: string | null) => void;
  startedAt: number;
}

let nextId = 1;
const queue: ExtractJob[] = [];
let notifyHost: (() => void) | null = null;

/** The host component registers its wake-up callback here when mounted. */
export const registerPdfHost = (notify: () => void): (() => void) => {
  notifyHost = notify;
  notify(); // drain anything already queued
  return () => { if (notifyHost === notify) notifyHost = null; };
};

export const isPdfHostReady = (): boolean => notifyHost !== null;

/** The host pulls the next pending job (or null). */
export const takeNextPdfJob = (): ExtractJob | null => queue.shift() || null;

const enqueue = (
  kind: ExtractKind,
  base64: string,
  opts: { maxPages?: number; maxChars?: number; lang?: string; timeoutMs?: number },
): Promise<string | null> =>
  new Promise((resolve) => {
    if (!base64) { resolve(null); return; }
    let settled = false;
    const done = (t: string | null) => { if (!settled) { settled = true; resolve(t); } };
    const job: ExtractJob = {
      id: nextId++, kind, base64,
      maxPages: opts.maxPages ?? 50,
      maxChars: opts.maxChars ?? 24_000,
      lang: opts.lang ?? 'eng+swe',
      resolve: done, startedAt: Date.now(),
    };
    queue.push(job);
    if (notifyHost) notifyHost();
    setTimeout(() => {
      const i = queue.indexOf(job);
      if (i >= 0) queue.splice(i, 1);
      done(null); // timed out (host missing or harness stalled)
    }, opts.timeoutMs ?? (kind === 'ocr' ? 60_000 : 30_000));
  });

/** Extract text from a base64 PDF. Resolves text (capped) or null. */
export const extractPdfTextMobile = (base64: string, maxPages = 50, maxChars = 24_000, timeoutMs = 30_000): Promise<string | null> =>
  enqueue('pdf', base64, { maxPages, maxChars, timeoutMs });

/** OCR a base64 image to text via Tesseract.js in the WebView. Resolves text (capped) or null. */
export const extractImageOcrMobile = (base64: string, lang = 'eng+swe', maxChars = 24_000, timeoutMs = 60_000): Promise<string | null> =>
  enqueue('ocr', base64, { lang, maxChars, timeoutMs });

/** Word .docx → text via mammoth.js in the WebView. */
export const extractDocxMobile = (base64: string, maxChars = 24_000, timeoutMs = 30_000): Promise<string | null> =>
  enqueue('docx', base64, { maxChars, timeoutMs });

/** Excel .xlsx → CSV-ish text via SheetJS in the WebView. */
export const extractXlsxMobile = (base64: string, maxChars = 24_000, timeoutMs = 30_000): Promise<string | null> =>
  enqueue('xlsx', base64, { maxChars, timeoutMs });
