/**
 * Hidden WebView that runs pdf.js (PDF → text) and Tesseract.js (image → OCR text) on mobile —
 * the platform piece left open since ADR 0006. Mount ONCE (renders nothing visible). It drains
 * the job queue in services/ai/pdfText.ts one item at a time. Both libraries load from PINNED
 * CDN URLs (the WebView has network; the ingest feature is online anyway). Bytes never leave the
 * WebView. No native OCR dependency — Tesseract.js is pure WASM/JS.
 */
import React from 'react';
import { View } from 'react-native';
import { registerPdfHost, takeNextPdfJob, type ExtractJob } from '@/services/ai/pdfText';

// Defensive load: if react-native-webview's native module is somehow absent from the build,
// requiring it must NOT crash the app at module load (this host is mounted app-wide). Render
// nothing instead — text-extraction features degrade gracefully (host stays "not ready").
let WebView: any = null;
try { WebView = require('react-native-webview').WebView; } catch { WebView = null; }

const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174';
const TESSERACT = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
const MAMMOTH = 'https://cdn.jsdelivr.net/npm/mammoth@1.12.0/mammoth.browser.min.js';
const SHEETJS = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';

const HARNESS = `<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body>
<script src="${PDFJS}/pdf.min.js"></script>
<script src="${TESSERACT}"></script>
<script src="${MAMMOTH}"></script>
<script src="${SHEETJS}"></script>
<script>
  function post(o){ try { window.ReactNativeWebView.postMessage(JSON.stringify(o)); } catch(e){} }
  function b64ToBytes(b64){ var raw=atob(b64); var arr=new Uint8Array(raw.length); for(var i=0;i<raw.length;i++) arr[i]=raw.charCodeAt(i); return arr; }
  function ready(){
    if (window.pdfjsLib && window.Tesseract && window.mammoth && window.XLSX) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = '${PDFJS}/pdf.worker.min.js';
      post({ ready: true });
    } else { setTimeout(ready, 200); }
  }
  window.__docx = async function(id, b64, maxChars){
    try {
      var res = await mammoth.extractRawText({ arrayBuffer: b64ToBytes(b64).buffer });
      post({ id: id, ok: true, text: ((res && res.value) || '').slice(0, maxChars) });
    } catch(e){ post({ id: id, ok: false, text: String((e && e.message) || e) }); }
  };
  window.__xlsx = async function(id, b64, maxChars){
    try {
      var wb = XLSX.read(b64, { type: 'base64' }); var out='';
      for (var i=0;i<wb.SheetNames.length;i++){
        var nm=wb.SheetNames[i]; var csv=XLSX.utils.sheet_to_csv(wb.Sheets[nm]);
        if (csv && csv.trim()) out += '# '+nm+'\\n'+csv+'\\n\\n';
        if (out.length>maxChars) break;
      }
      post({ id: id, ok: true, text: out.slice(0, maxChars) });
    } catch(e){ post({ id: id, ok: false, text: String((e && e.message) || e) }); }
  };
  window.__pdf = async function(id, b64, maxPages, maxChars){
    try {
      var raw = atob(b64); var arr = new Uint8Array(raw.length);
      for (var i=0;i<raw.length;i++) arr[i]=raw.charCodeAt(i);
      var pdf = await pdfjsLib.getDocument({ data: arr }).promise;
      var n = Math.min(pdf.numPages, maxPages); var out='';
      for (var p=1;p<=n;p++){
        var page = await pdf.getPage(p); var tc = await page.getTextContent();
        out += tc.items.map(function(it){ return it.str; }).join(' ') + '\\n';
        if (out.length > maxChars) break;
      }
      post({ id: id, ok: true, text: out.slice(0, maxChars) });
    } catch(e){ post({ id: id, ok: false, text: String((e && e.message) || e) }); }
  };
  window.__ocr = async function(id, b64, lang, maxChars){
    try {
      var res = await Tesseract.recognize('data:image/*;base64,' + b64, lang || 'eng');
      var t = (res && res.data && res.data.text) || '';
      post({ id: id, ok: true, text: t.slice(0, maxChars) });
    } catch(e){ post({ id: id, ok: false, text: String((e && e.message) || e) }); }
  };
  ready();
</script></body></html>`;

export const PdfExtractorHost: React.FC = () => {
  const ref = React.useRef<any>(null);
  const readyRef = React.useRef(false);
  const currentRef = React.useRef<ExtractJob | null>(null);

  // Hard guard: if the WebView native view dies (Android "render process gone"), an OS error,
  // or any WebView callback throws, the host must recover quietly — never crash the app it's
  // mounted in. We mark not-ready and fail any in-flight job rather than propagate.
  const failCurrent = React.useCallback(() => {
    const job = currentRef.current;
    if (job) { try { job.resolve(null); } catch { /* ignore */ } currentRef.current = null; }
    readyRef.current = false;
  }, []);

  const pump = React.useCallback(() => {
    if (!readyRef.current || currentRef.current) return;
    const job = takeNextPdfJob();
    if (!job) return;
    currentRef.current = job;
    let js: string;
    if (job.kind === 'ocr') js = `window.__ocr(${job.id}, '${job.base64}', '${job.lang}', ${job.maxChars}); true;`;
    else if (job.kind === 'docx') js = `window.__docx(${job.id}, '${job.base64}', ${job.maxChars}); true;`;
    else if (job.kind === 'xlsx') js = `window.__xlsx(${job.id}, '${job.base64}', ${job.maxChars}); true;`;
    else js = `window.__pdf(${job.id}, '${job.base64}', ${job.maxPages}, ${job.maxChars}); true;`;
    ref.current?.injectJavaScript(js);
  }, []);

  React.useEffect(() => registerPdfHost(pump), [pump]);

  const onMessage = (e: any) => {
    let data: any;
    try { data = JSON.parse(e.nativeEvent.data); } catch { return; }
    try {
      if (data.ready) { readyRef.current = true; pump(); return; }
      const job = currentRef.current;
      if (job && data.id === job.id) {
        job.resolve(data.ok ? (data.text || '') : null);
        currentRef.current = null;
        pump();
      }
    } catch { /* never let a message-handler error escape */ }
  };

  if (!WebView) return null;

  return (
    <View style={{ width: 0, height: 0, position: 'absolute', opacity: 0 }} pointerEvents="none">
      <WebView
        ref={ref}
        source={{ html: HARNESS, baseUrl: 'https://localhost' }}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
        onMessage={onMessage}
        scrollEnabled={false}
        // Recover from a dead WebView render process / load error instead of crashing.
        onError={() => failCurrent()}
        onContentProcessDidTerminate={() => failCurrent()}
        onRenderProcessGone={() => { failCurrent(); return true; }}
        style={{ width: 0, height: 0 }}
      />
    </View>
  );
};

export default PdfExtractorHost;
