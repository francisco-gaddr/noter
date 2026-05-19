const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  validateNoterFilePath,
  extractOpenFilePathFromArgv,
  SUPPORTED_EXTENSIONS,
} = require('../src/fileAssociation');

describe('validateNoterFilePath', () => {
  let tmpDir;
  let noteFile;
  let imageFile;
  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'noter-assoc-'));
    noteFile = path.join(tmpDir, 'mynote.noter');
    fs.writeFileSync(noteFile, 'hello');
    imageFile = path.join(tmpDir, 'photo.png');
    fs.writeFileSync(imageFile, 'png-bytes');
  });
  afterAll(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  it('accepts a real .noter file', () => {
    expect(validateNoterFilePath(noteFile)).toBe(true);
  });

  it('accepts .md and .txt', () => {
    const md = path.join(tmpDir, 'note.md');
    fs.writeFileSync(md, '# hello');
    expect(validateNoterFilePath(md)).toBe(true);
    const txt = path.join(tmpDir, 'note.txt');
    fs.writeFileSync(txt, 'hello');
    expect(validateNoterFilePath(txt)).toBe(true);
  });

  it('rejects unsupported extensions', () => {
    expect(validateNoterFilePath(imageFile)).toBe(false);
  });

  it('rejects empty / non-string / over-long', () => {
    expect(validateNoterFilePath('')).toBe(false);
    expect(validateNoterFilePath(null)).toBe(false);
    expect(validateNoterFilePath('x'.repeat(5000))).toBe(false);
  });

  it('rejects paths with null bytes', () => {
    expect(validateNoterFilePath('/tmp/file\0.noter')).toBe(false);
  });

  it('rejects non-existent files', () => {
    expect(validateNoterFilePath(path.join(tmpDir, 'missing.noter'))).toBe(false);
  });

  it('rejects directories with .noter name', () => {
    const dir = path.join(tmpDir, 'fakefile.noter');
    fs.mkdirSync(dir);
    expect(validateNoterFilePath(dir)).toBe(false);
  });
});

describe('extractOpenFilePathFromArgv', () => {
  let tmpDir;
  let noteFile;
  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'noter-argv-'));
    noteFile = path.join(tmpDir, 'launch.noter');
    fs.writeFileSync(noteFile, 'hi');
  });
  afterAll(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  it('returns first .noter path in argv', () => {
    const r = extractOpenFilePathFromArgv(['/path/to/electron', '--something', noteFile]);
    expect(r).toBe(path.resolve(noteFile));
  });

  it('ignores flags', () => {
    const r = extractOpenFilePathFromArgv(['--inspect', '-v', noteFile]);
    expect(r).toBe(path.resolve(noteFile));
  });

  it('ignores noter:// deeplink entries', () => {
    const r = extractOpenFilePathFromArgv(['noter://note/abc']);
    expect(r).toBeNull();
  });

  it('returns null when no valid file present', () => {
    expect(extractOpenFilePathFromArgv(['/usr/bin/electron'])).toBeNull();
  });

  it('rejects non-array input', () => {
    expect(extractOpenFilePathFromArgv(null)).toBeNull();
    expect(extractOpenFilePathFromArgv('a string')).toBeNull();
  });

  it('exports the supported extension list', () => {
    expect(SUPPORTED_EXTENSIONS).toContain('.noter');
    expect(SUPPORTED_EXTENSIONS).toContain('.md');
  });
});
