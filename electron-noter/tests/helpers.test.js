const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  isWindows11,
  validateSpellCheckerCdn,
  validateThumbnailPath,
  clampThumbnailSize,
  buildIsolatedScript,
} = require('../src/helpers');

describe('isWindows11', () => {
  it('returns false on non-win32 platforms', () => {
    expect(isWindows11('darwin', '24.0.0')).toBe(false);
    expect(isWindows11('linux', '6.0.0')).toBe(false);
  });

  it('returns false on Windows 10 (build < 22000)', () => {
    expect(isWindows11('win32', '10.0.19045')).toBe(false);
  });

  it('returns true on Windows 11 (build >= 22000)', () => {
    expect(isWindows11('win32', '10.0.22000')).toBe(true);
    expect(isWindows11('win32', '10.0.22631')).toBe(true);
  });

  it('returns true for hypothetical future major versions', () => {
    expect(isWindows11('win32', '11.0.0')).toBe(true);
  });

  it('returns false on malformed release strings', () => {
    expect(isWindows11('win32', 'not-a-release')).toBe(false);
    expect(isWindows11('win32', '')).toBe(false);
  });
});

describe('validateSpellCheckerCdn', () => {
  it('returns null for falsy / non-strings', () => {
    expect(validateSpellCheckerCdn('')).toBeNull();
    expect(validateSpellCheckerCdn('   ')).toBeNull();
    expect(validateSpellCheckerCdn(null)).toBeNull();
    expect(validateSpellCheckerCdn(undefined)).toBeNull();
    expect(validateSpellCheckerCdn(123)).toBeNull();
  });

  it('rejects http (must be https)', () => {
    expect(validateSpellCheckerCdn('http://example.com')).toBeNull();
  });

  it('rejects malformed URLs', () => {
    expect(validateSpellCheckerCdn('not a url')).toBeNull();
  });

  it('accepts https URLs and adds trailing slash', () => {
    expect(validateSpellCheckerCdn('https://cdn.example.com')).toBe('https://cdn.example.com/');
    expect(validateSpellCheckerCdn('https://cdn.example.com/')).toBe('https://cdn.example.com/');
    expect(validateSpellCheckerCdn('  https://cdn.example.com  ')).toBe('https://cdn.example.com/');
  });
});

describe('clampThumbnailSize', () => {
  it('defaults to 128x128', () => {
    expect(clampThumbnailSize(undefined)).toEqual({ width: 128, height: 128 });
    expect(clampThumbnailSize({})).toEqual({ width: 128, height: 128 });
  });

  it('clamps positive values below 16 up to 16', () => {
    expect(clampThumbnailSize({ width: 10, height: 10 })).toEqual({ width: 16, height: 16 });
  });

  it('treats 0 as fallback (falsy) and negative as clamp-to-16', () => {
    // Number(0) || 128 = 128 — zero is falsy, fallback used.
    // Number(-5) = -5 (truthy), then clamped up to lower bound 16.
    expect(clampThumbnailSize({ width: 0, height: -5 })).toEqual({ width: 128, height: 16 });
  });

  it('clamps to upper bound 512', () => {
    expect(clampThumbnailSize({ width: 9999, height: 9999 })).toEqual({ width: 512, height: 512 });
  });

  it('passes through valid sizes', () => {
    expect(clampThumbnailSize({ width: 64, height: 128 })).toEqual({ width: 64, height: 128 });
  });
});

describe('validateThumbnailPath', () => {
  let tmpDir;
  let allowedFile;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumb-test-'));
    allowedFile = path.join(tmpDir, 'allowed.png');
    fs.writeFileSync(allowedFile, 'png-bytes');
  });

  afterAll(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* noop */ }
  });

  it('rejects empty or non-string paths', () => {
    expect(() => validateThumbnailPath('', [tmpDir])).toThrow(/filePath required/);
    expect(() => validateThumbnailPath(null, [tmpDir])).toThrow(/filePath required/);
  });

  it('rejects paths outside allowed roots (path traversal)', () => {
    expect(() => validateThumbnailPath('/etc/passwd', [tmpDir])).toThrow(/outside allowed roots/);
    expect(() => validateThumbnailPath(path.join(tmpDir, '..', 'evil.png'), [tmpDir])).toThrow(/outside allowed roots/);
  });

  it('rejects allowed-root files that do not exist', () => {
    expect(() => validateThumbnailPath(path.join(tmpDir, 'missing.png'), [tmpDir])).toThrow(/file not found/);
  });

  it('accepts files within an allowed root', () => {
    expect(validateThumbnailPath(allowedFile, [tmpDir])).toBe(path.resolve(allowedFile));
  });

  it('honours multiple allowed roots', () => {
    const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thumb-test-2-'));
    expect(() => validateThumbnailPath(allowedFile, [otherDir])).toThrow(/outside allowed roots/);
    expect(validateThumbnailPath(allowedFile, [otherDir, tmpDir])).toBe(path.resolve(allowedFile));
    fs.rmSync(otherDir, { recursive: true, force: true });
  });
});

describe('buildIsolatedScript', () => {
  it('rejects unknown keys', () => {
    expect(() => buildIsolatedScript('totally-made-up', 'whatever')).toThrow(/unknown isolated script/);
  });

  it('builds highlight-search code containing the JSON-encoded term', () => {
    const code = buildIsolatedScript('highlight-search', 'hello');
    expect(typeof code).toBe('string');
    expect(code).toContain('"hello"'); // JSON.stringify embeds quotes
    expect(code).toContain('document.createTreeWalker');
  });

  it('returns noop for empty search term', () => {
    expect(buildIsolatedScript('highlight-search', '')).toBe('noop');
    expect(buildIsolatedScript('highlight-search', null)).toBe('noop');
  });

  it('escapes injected characters via JSON.stringify (no string-context escape)', () => {
    const code = buildIsolatedScript('highlight-search', '"; window.evil=1; //');
    // The injected term is inside a JSON-encoded string literal — any
    // attempt to escape the string context shows up as a backslash-escaped
    // quote in the source rather than as raw `";`. Presence of `\";` AND the
    // assignment being inside the string (between escaped quotes) proves
    // the injection cannot execute.
    expect(code).toContain('\\";');
    // Verify the entire injection lives inside one JSON string literal —
    // that is, no unescaped `"` appears between the const term = " ... "; declaration.
    const m = code.match(/const term = (".*?[^\\]");/);
    expect(m).not.toBeNull();
    expect(m[1]).toContain('window.evil=1'); // it's text, not code
  });
});
