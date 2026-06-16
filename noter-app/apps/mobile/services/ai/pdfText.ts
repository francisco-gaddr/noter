/**
 * Mobile PDF text extraction via a WebView-hosted pdf.js harness (the platform-specific piece
 * left open since ADR 0006). This module is the imperative API + job queue; the actual work is
 * done by <PdfExtractorHost/> (mounted once in the app), which renders a hidden WebView, runs
 * pdf.js on the base64 bytes, and resolves the job.
 *
 * Decoupling the queue from the component lets any service (e.g. Nextcloud ingest) call
 * extractPdfTextMobile() and await text without owning a WebView. Returns null on any failure
 * (no host mounted, parse error, timeout) so callers degrade to a provenance placeholder.
 */
export interface PdfJob {
  id: number;
  base64: string;
  maxPages: number;
  maxChars: number;
  resolve: (text: string | null) => void;
  startedAt: number;
}

let nextId = 1;
const queue: PdfJob[] = [];
let notifyHost: (() => void) | null = null;

/** The host component registers its wake-up callback here when mounted. */
export const registerPdfHost = (notify: () => void): (() => void) => {
  notifyHost = notify;
  notify(); // drain anything already queued
  return () => { if (notifyHost === notify) notifyHost = null; };
};

export const isPdfHostReady = (): boolean => notifyHost !== null;

/** The host pulls the next pending job (or null). */
export const takeNextPdfJob = (): PdfJob | null => queue.shift() || null;

/**
 * Queue a base64 PDF for extraction. Resolves with the text (capped) or null. If no host is
 * mounted within a short grace period, resolves null so ingestion never hangs.
 */
export const extractPdfTextMobile = (
  base64: string,
  maxPages = 50,
  maxChars = 24_000,
  timeoutMs = 30_000,
): Promise<string | null> =>
  new Promise((resolve) => {
    if (!base64) { resolve(null); return; }
    const job: PdfJob = { id: nextId++, base64, maxPages, maxChars, resolve, startedAt: Date.now() };
    let settled = false;
    const done = (t: string | null) => { if (!settled) { settled = true; resolve(t); } };
    job.resolve = done;
    queue.push(job);
    if (notifyHost) notifyHost();
    setTimeout(() => {
      const i = queue.indexOf(job);
      if (i >= 0) queue.splice(i, 1);
      done(null); // timed out (host missing or pdf.js stalled)
    }, timeoutMs);
  });
