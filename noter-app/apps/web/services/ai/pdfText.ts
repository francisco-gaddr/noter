/**
 * Client-side PDF → text extraction using pdfjs-dist, loaded via a DYNAMIC import so it
 * never touches the SSR / Electron static-export build path. Returns null on any failure
 * (no pdfjs, encrypted/scanned PDF, worker issue) so the caller falls back cleanly to the
 * "binary attachment" placeholder — extraction is a best-effort enhancement, never a hard
 * dependency. Once we have text, the shared attachmentToGraphNote can store it as a
 * searchable graph node.
 */
export const extractPdfText = async (file: File, maxChars = 24_000, maxPages = 50): Promise<string | null> => {
  try {
    const pdfjs: any = await import('pdfjs-dist');
    // Bundle the worker via the standard URL pattern (webpack/turbopack rewrite this).
    try {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
    } catch {
      /* worker src best-effort; pdfjs may still run on the main thread */
    }
    const data = new Uint8Array(await file.arrayBuffer());
    const doc = await pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: true }).promise;
    const pages = Math.min(doc.numPages || 0, maxPages);
    let out = '';
    for (let i = 1; i <= pages; i += 1) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      out += content.items.map((it: any) => (typeof it?.str === 'string' ? it.str : '')).join(' ') + '\n';
      if (out.length >= maxChars) break;
    }
    try { await doc.destroy?.(); } catch { /* ignore */ }
    const trimmed = out.replace(/[ \t]+\n/g, '\n').trim();
    return trimmed.length > 0 ? trimmed.slice(0, maxChars) : null;
  } catch {
    return null;
  }
};
