const fs = require('fs');
const path = require('path');
const os = require('os');
const { validateDroppedFile } = require('../src/dragDrop');

describe('validateDroppedFile', () => {
  let tmpDir;
  let allowedFile;
  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'noter-drop-'));
    allowedFile = path.join(tmpDir, 'note.md');
    fs.writeFileSync(allowedFile, '# Hello');
  });
  afterAll(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  it('rejects invalid payloads', () => {
    expect(validateDroppedFile(null).ok).toBe(false);
    expect(validateDroppedFile({}).ok).toBe(false);
    expect(validateDroppedFile({ path: '' }).ok).toBe(false);
  });

  it('rejects paths with null byte (defence against path-traversal libc tricks)', () => {
    expect(validateDroppedFile({ path: '/some/file\0.md', name: 'x.md', type: 'text/markdown', size: 100 }).ok).toBe(false);
  });

  it('rejects MIME types not on the allow-list', () => {
    const out = validateDroppedFile({ path: allowedFile, name: 'note.exe', type: 'application/x-msdownload', size: 100 });
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('mime-or-ext-not-allowed');
  });

  it('accepts files matching the MIME OR extension allow-list', () => {
    const out = validateDroppedFile({ path: allowedFile, name: 'note.md', type: 'text/markdown', size: 100 });
    expect(out.ok).toBe(true);
    expect(out.ext).toBe('.md');
  });

  it('rejects files larger than maxBytes', () => {
    const out = validateDroppedFile(
      { path: allowedFile, name: 'note.md', type: 'text/markdown', size: 20 * 1024 * 1024 },
      { maxBytes: 1024 }
    );
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('too-large');
  });

  it('falls back to fs.stat when size is missing', () => {
    const out = validateDroppedFile({ path: allowedFile, name: 'note.md', type: 'text/markdown' });
    expect(out.ok).toBe(true);
    expect(out.bytes).toBeGreaterThan(0);
  });

  it('rejects path that does not point to a real file', () => {
    const out = validateDroppedFile({ path: path.join(tmpDir, 'missing.md'), name: 'missing.md', type: 'text/markdown' });
    expect(out.ok).toBe(false);
  });

  it('resolves path to absolute on success', () => {
    const out = validateDroppedFile({ path: allowedFile, name: 'note.md', type: 'text/markdown', size: 6 });
    expect(out.ok).toBe(true);
    expect(path.isAbsolute(out.resolvedPath)).toBe(true);
  });
});
