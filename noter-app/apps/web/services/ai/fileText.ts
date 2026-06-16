/**
 * Unified client-side file → text extraction for web/Electron, shared by the AI chat file
 * upload AND the Nextcloud ingest. Turns PDFs, Word (.docx), Excel (.xlsx), Apple Pages/Numbers
 * (best-effort) and images (OCR) into plain text the model can read. Text-like files are handled
 * by the callers directly (FileReader). Heavy parsers (pdf.js, mammoth, SheetJS, Tesseract.js)
 * are dynamically imported / lazily loaded so they never touch the SSR/export build.
 */
import { classifyFile, type IngestFileKind } from '@repo/shared';
import { extractPdfText } from './pdfText';

const CAP = 24_000;

/** Word .docx → raw text (mammoth). */
export const extractDocx = async (buf: ArrayBuffer): Promise<string> => {
  try {
    const mammoth: any = await import('mammoth');
    const fn = mammoth.extractRawText || (mammoth.default && mammoth.default.extractRawText);
    const res = await fn({ arrayBuffer: buf });
    return (res?.value || '').slice(0, CAP);
  } catch { return ''; }
};

/** Excel .xlsx/.xls → CSV-ish text per sheet (SheetJS). */
export const extractXlsx = async (buf: ArrayBuffer): Promise<string> => {
  try {
    const XLSX: any = await import('xlsx');
    const wb = XLSX.read(buf, { type: 'array' });
    const parts: string[] = [];
    for (const name of wb.SheetNames) {
      const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name]);
      if (csv.trim()) parts.push(`# ${name}\n${csv}`);
      if (parts.join('\n').length > CAP) break;
    }
    return parts.join('\n\n').slice(0, CAP);
  } catch { return ''; }
};

// ---- image OCR (lazy Tesseract.js from a pinned CDN — no bundled dep) ---------
let tesseractLoading: Promise<any> | null = null;
const loadTesseract = (): Promise<any> => {
  if (typeof document === 'undefined') return Promise.reject(new Error('no dom'));
  const w = window as any;
  if (w.Tesseract) return Promise.resolve(w.Tesseract);
  if (!tesseractLoading) {
    tesseractLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
      s.onload = () => resolve((window as any).Tesseract);
      s.onerror = () => reject(new Error('Tesseract kunde inte laddas'));
      document.head.appendChild(s);
    });
  }
  return tesseractLoading;
};
export const ocrImageWeb = async (buf: ArrayBuffer, mime: string): Promise<string> => {
  try {
    const T = await loadTesseract();
    const url = URL.createObjectURL(new Blob([buf], { type: mime || 'image/png' }));
    try { const res = await T.recognize(url, 'eng+swe'); return (res?.data?.text || '').slice(0, CAP); }
    finally { URL.revokeObjectURL(url); }
  } catch { return ''; }
};

/**
 * Apple Pages/Numbers are zip bundles. Modern iWork stores content as IWA protobuf (not
 * parseable without a dedicated lib), but most bundles also embed a QuickLook/Preview.pdf —
 * extract its text if present, else return '' (caller keeps a provenance placeholder).
 */
export const extractIWorkPreview = async (buf: ArrayBuffer): Promise<string> => {
  try {
    const JSZip: any = (await import('jszip')).default || (await import('jszip'));
    const zip = await JSZip.loadAsync(buf);
    const previewPath = Object.keys(zip.files).find((p) => /preview\.pdf$/i.test(p) || /QuickLook\/Preview\.pdf$/i.test(p));
    if (!previewPath) return '';
    const pdfBuf: ArrayBuffer = await zip.files[previewPath].async('arraybuffer');
    return (await extractPdfText(new File([pdfBuf], 'preview.pdf', { type: 'application/pdf' }))) || '';
  } catch { return ''; }
};

/** Dispatch a File to the right extractor. Returns null when nothing readable. */
export const extractFileText = async (file: File): Promise<{ text: string | null; kind: IngestFileKind }> => {
  const kind = classifyFile(file.name, file.type);
  try {
    if (kind === 'pdf') return { text: await extractPdfText(file), kind };
    if (kind === 'docx') return { text: await extractDocx(await file.arrayBuffer()), kind };
    if (kind === 'xlsx') return { text: await extractXlsx(await file.arrayBuffer()), kind };
    if (kind === 'pages') return { text: await extractIWorkPreview(await file.arrayBuffer()), kind };
    if (kind === 'image') return { text: await ocrImageWeb(await file.arrayBuffer(), file.type), kind };
  } catch { /* fall through */ }
  return { text: null, kind };
};

/** Same as extractFileText but from an ArrayBuffer + name/mime (for the Nextcloud ingest path). */
export const extractBufferText = async (buf: ArrayBuffer, name: string, mime: string): Promise<string> => {
  const kind = classifyFile(name, mime);
  if (kind === 'docx') return extractDocx(buf);
  if (kind === 'xlsx') return extractXlsx(buf);
  if (kind === 'pages') return extractIWorkPreview(buf);
  if (kind === 'image') return ocrImageWeb(buf, mime);
  if (kind === 'pdf') return (await extractPdfText(new File([buf], name, { type: 'application/pdf' }))) || '';
  return '';
};
