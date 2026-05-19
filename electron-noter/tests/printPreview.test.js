const { buildPreviewHtml, previewWindowOptions, PREVIEW_MAX_BYTES } = require('../src/printPreview');

describe('buildPreviewHtml', () => {
  const okDataUrl = 'data:application/pdf;base64,abc123==';

  it('rejects non-pdf data URLs', () => {
    expect(() => buildPreviewHtml({ dataUrl: 'data:image/png;base64,abc', title: 'x' })).toThrow(/application\/pdf/);
    expect(() => buildPreviewHtml({ dataUrl: '', title: 'x' })).toThrow(/application\/pdf/);
  });

  it('rejects PDFs above the size cap', () => {
    expect(() => buildPreviewHtml({
      dataUrl: okDataUrl, title: 'x', bytes: PREVIEW_MAX_BYTES + 1,
    })).toThrow(/bytes/);
  });

  it('embeds the PDF as a data: URL in <object>', () => {
    const html = buildPreviewHtml({ dataUrl: okDataUrl, title: 'My note' });
    expect(html).toContain(okDataUrl);
    expect(html).toContain('My note');
    expect(html).toContain('<object data="');
  });

  it('escapes title HTML', () => {
    const html = buildPreviewHtml({ dataUrl: okDataUrl, title: '<script>alert(1)</script>' });
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
  });

  it('emits a CSP that blocks remote scripts', () => {
    const html = buildPreviewHtml({ dataUrl: okDataUrl, title: 'x' });
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("script-src 'unsafe-inline'");
    expect(html).not.toContain('script-src https:');
  });
});

describe('previewWindowOptions', () => {
  it('returns safe webPreferences', () => {
    const o = previewWindowOptions();
    expect(o.webPreferences.nodeIntegration).toBe(false);
    expect(o.webPreferences.contextIsolation).toBe(true);
    expect(o.webPreferences.sandbox).toBe(true);
  });

  it('positions relative to parent when given', () => {
    const o = previewWindowOptions({ parentBounds: { x: 100, y: 200, width: 800, height: 600 } });
    expect(o.x).toBe(140);
    expect(o.y).toBe(240);
  });

  it('omits x/y when no parent bounds', () => {
    const o = previewWindowOptions();
    expect(o.x).toBeUndefined();
    expect(o.y).toBeUndefined();
  });
});
