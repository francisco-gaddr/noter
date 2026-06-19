jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: '/tmp/cache/',
  writeAsStringAsync: jest.fn(() => Promise.resolve()),
  EncodingType: { UTF8: 'utf8' },
}));

jest.mock('expo-print', () => ({
  printToFileAsync: jest.fn(() => Promise.resolve({ uri: '/tmp/note.pdf' })),
}));

jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(() => Promise.resolve(true)),
  shareAsync: jest.fn(() => Promise.resolve()),
}));

import {
  buildMarkdownExport,
  buildHtmlExport,
  exportNoteToMarkdown,
  exportNoteToPdf,
  LockedNoteExportError,
  _safeFilename,
  _escapeHtml,
} from '../../services/noteExport';

// Handles to the mocked native modules so we can assert nothing is written/shared off-device.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const FileSystem = require('expo-file-system/legacy');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Print = require('expo-print');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Sharing = require('expo-sharing');

const baseNote = {
  id: 'n1',
  title: 'Hello',
  content: 'Body text',
  createdAt: '2026-05-19T10:00:00Z',
  updatedAt: '2026-05-19T11:00:00Z',
};

describe('buildMarkdownExport', () => {
  it('throws on locked notes', () => {
    expect(() => buildMarkdownExport({ ...baseNote, locked: true })).toThrow(LockedNoteExportError);
  });

  it('emits a title heading and body', () => {
    const md = buildMarkdownExport(baseNote);
    expect(md).toContain('# Hello');
    expect(md).toContain('Body text');
    expect(md).toContain('_Updated: 2026-05-19T11:00:00Z_');
  });

  it('uses "Untitled note" when title is missing', () => {
    const md = buildMarkdownExport({ ...baseNote, title: '' });
    expect(md).toContain('# Untitled note');
  });
});

describe('buildHtmlExport', () => {
  it('refuses locked notes', () => {
    expect(() => buildHtmlExport({ ...baseNote, locked: true })).toThrow(LockedNoteExportError);
  });

  it('wraps plain-text content in pre', () => {
    const html = buildHtmlExport({ ...baseNote, content: 'line one\nline two' });
    expect(html).toContain('<pre');
    expect(html).toContain('line one');
  });

  it('preserves HTML content directly', () => {
    const html = buildHtmlExport({ ...baseNote, content: '<p>Hello <b>world</b></p>' });
    expect(html).toContain('<p>Hello <b>world</b></p>');
    expect(html).not.toContain('<pre');
  });

  it('escapes title HTML', () => {
    const html = buildHtmlExport({ ...baseNote, title: '<script>alert(1)</script>' });
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('safeFilename', () => {
  it('replaces reserved characters with underscore', () => {
    expect(_safeFilename('foo/bar:baz')).toBe('foo_bar_baz');
  });

  it('falls back to "note" for empty input', () => {
    expect(_safeFilename('')).toBe('note');
    expect(_safeFilename('!!!')).toBe('!!!');
  });

  it('clamps overly-long names', () => {
    const out = _safeFilename('x'.repeat(500));
    expect(out.length).toBeLessThanOrEqual(120);
  });
});

describe('escapeHtml', () => {
  it('escapes the five XML-unsafe characters', () => {
    expect(_escapeHtml(`<a href="x">'A&B'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;A&amp;B&#39;&lt;/a&gt;');
  });
});

// The async exporters are the RUNTIME off-device-leak guard: the note editor passes
// `locked: !!blockingLockedAncestor` (true for a note inside a LOCKED FOLDER, not just a
// directly-locked note). These must REFUSE and never write a file or pop the OS share sheet,
// so locked-folder content can never escape the device via Share-as-PDF / Share-as-Markdown.
describe('async exporters refuse locked notes (no file written, no share)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('exportNoteToMarkdown returns {ok:false} and writes/shares nothing when locked', async () => {
    const res = await exportNoteToMarkdown({ ...baseNote, locked: true });
    expect(res.ok).toBe(false);
    expect((res as { ok: false; reason: string }).reason).toMatch(/locked/i);
    expect(FileSystem.writeAsStringAsync).not.toHaveBeenCalled();
    expect(Sharing.shareAsync).not.toHaveBeenCalled();
  });

  it('exportNoteToPdf returns {ok:false} and renders/shares nothing when locked', async () => {
    const res = await exportNoteToPdf({ ...baseNote, locked: true });
    expect(res.ok).toBe(false);
    expect((res as { ok: false; reason: string }).reason).toMatch(/locked/i);
    expect(Print.printToFileAsync).not.toHaveBeenCalled();
    expect(Sharing.shareAsync).not.toHaveBeenCalled();
  });

  it('exportNoteToMarkdown succeeds for an unlocked note (writes + shares)', async () => {
    const res = await exportNoteToMarkdown(baseNote);
    expect(res.ok).toBe(true);
    expect(FileSystem.writeAsStringAsync).toHaveBeenCalledTimes(1);
    expect(Sharing.shareAsync).toHaveBeenCalledTimes(1);
  });

  it('exportNoteToPdf succeeds for an unlocked note (renders + shares)', async () => {
    const res = await exportNoteToPdf(baseNote);
    expect(res.ok).toBe(true);
    expect(Print.printToFileAsync).toHaveBeenCalledTimes(1);
    expect(Sharing.shareAsync).toHaveBeenCalledTimes(1);
  });
});
