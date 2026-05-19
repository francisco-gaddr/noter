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
  LockedNoteExportError,
  _safeFilename,
  _escapeHtml,
} from '../../services/noteExport';

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
