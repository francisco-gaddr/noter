/**
 * Hidden WebView that runs pdf.js to extract text from base64 PDFs on mobile (the platform
 * piece left open since ADR 0006). Mount ONCE (it renders nothing visible). It drains the
 * job queue in services/ai/pdfText.ts: one PDF at a time, inject base64 → pdf.js → post text
 * back. pdf.js is loaded from a PINNED cdnjs URL (the WebView has network; the feature is
 * online anyway). Everything stays on-device — the PDF bytes never leave the WebView.
 */
import React from 'react';
import { View } from 'react-native';
import { WebView } from 'react-native-webview';
import { registerPdfHost, takeNextPdfJob, type PdfJob } from '@/services/ai/pdfText';

const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174';

const HARNESS = `<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body>
<script src="${PDFJS}/pdf.min.js"></script>
<script>
  function post(o){ try { window.ReactNativeWebView.postMessage(JSON.stringify(o)); } catch(e){} }
  function ready(){
    if (window.pdfjsLib) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = '${PDFJS}/pdf.worker.min.js';
      post({ ready: true });
    } else { setTimeout(ready, 150); }
  }
  window.__extract = async function(id, b64, maxPages, maxChars){
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
  ready();
</script></body></html>`;

export const PdfExtractorHost: React.FC = () => {
  const ref = React.useRef<WebView>(null);
  const readyRef = React.useRef(false);
  const currentRef = React.useRef<PdfJob | null>(null);

  const pump = React.useCallback(() => {
    if (!readyRef.current || currentRef.current) return;
    const job = takeNextPdfJob();
    if (!job) return;
    currentRef.current = job;
    const js = `window.__extract(${job.id}, '${job.base64}', ${job.maxPages}, ${job.maxChars}); true;`;
    ref.current?.injectJavaScript(js);
  }, []);

  React.useEffect(() => registerPdfHost(pump), [pump]);

  const onMessage = (e: any) => {
    let data: any;
    try { data = JSON.parse(e.nativeEvent.data); } catch { return; }
    if (data.ready) { readyRef.current = true; pump(); return; }
    const job = currentRef.current;
    if (job && data.id === job.id) {
      job.resolve(data.ok ? (data.text || '') : null);
      currentRef.current = null;
      pump();
    }
  };

  return (
    <View style={{ width: 0, height: 0, position: 'absolute', opacity: 0 }} pointerEvents="none">
      <WebView
        ref={ref}
        source={{ html: HARNESS, baseUrl: 'https://localhost' }}
        originWhitelist={['*']}
        javaScriptEnabled
        onMessage={onMessage}
        // Hidden, no scroll/zoom; we only use it as a pdf.js sandbox.
        scrollEnabled={false}
        style={{ width: 0, height: 0 }}
      />
    </View>
  );
};

export default PdfExtractorHost;
