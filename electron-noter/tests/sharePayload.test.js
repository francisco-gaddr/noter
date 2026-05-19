const fs = require('fs');
const path = require('path');
const os = require('os');
const { validateSharePayload, hasShareablePayload } = require('../src/sharePayload');

describe('validateSharePayload', () => {
  let tmpDir;
  let goodFile;
  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'noter-share-'));
    goodFile = path.join(tmpDir, 'doc.md');
    fs.writeFileSync(goodFile, 'shareable');
  });
  afterAll(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  it('returns empty payload for non-object input', () => {
    expect(validateSharePayload(null)).toEqual({ texts: [], urls: [], filePaths: [] });
    expect(validateSharePayload('not-an-object')).toEqual({ texts: [], urls: [], filePaths: [] });
  });

  it('strips control characters from text payloads', () => {
    const out = validateSharePayload({ texts: ['hello\x07world'] });
    expect(out.texts).toEqual(['helloworld']);
  });

  it('rejects empty / over-long text', () => {
    const out = validateSharePayload({ texts: ['', 'x'.repeat(5000)] });
    expect(out.texts).toEqual([]);
  });

  it('accepts http(s) URLs only', () => {
    const out = validateSharePayload({ urls: [
      'https://example.com',
      'http://example.com',
      'ftp://example.com',     // ❌
      'javascript:alert(1)',   // ❌
      'file:///etc/passwd',    // ❌
    ] });
    expect(out.urls).toEqual(['https://example.com', 'http://example.com']);
  });

  it('caps total entries at MAX_ENTRIES', () => {
    const many = Array.from({ length: 20 }, (_, i) => `https://example.com/${i}`);
    const out = validateSharePayload({ urls: many });
    expect(out.urls.length).toBeLessThanOrEqual(5);
  });

  it('accepts file paths inside allowedRoots', () => {
    const out = validateSharePayload({ filePaths: [goodFile] }, { allowedRoots: [tmpDir] });
    expect(out.filePaths).toEqual([path.resolve(goodFile)]);
  });

  it('rejects file paths outside allowedRoots', () => {
    const out = validateSharePayload({ filePaths: ['/etc/passwd'] }, { allowedRoots: [tmpDir] });
    expect(out.filePaths).toEqual([]);
  });

  it('rejects non-existent files', () => {
    const out = validateSharePayload(
      { filePaths: [path.join(tmpDir, 'missing.md')] },
      { allowedRoots: [tmpDir] }
    );
    expect(out.filePaths).toEqual([]);
  });

  it('rejects paths with null bytes', () => {
    const out = validateSharePayload({ filePaths: ['/tmp/file\0.md'] });
    expect(out.filePaths).toEqual([]);
  });
});

describe('hasShareablePayload', () => {
  it('true when at least one list is non-empty', () => {
    expect(hasShareablePayload({ texts: ['hi'], urls: [], filePaths: [] })).toBe(true);
    expect(hasShareablePayload({ texts: [], urls: ['https://x'], filePaths: [] })).toBe(true);
  });

  it('false when all lists are empty', () => {
    expect(hasShareablePayload({ texts: [], urls: [], filePaths: [] })).toBe(false);
  });
});
