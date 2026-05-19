import { tokeniseMarkdown, _isSafeUrl, _tokeniseInline } from '../../utils/markdownSanitize';

describe('isSafeUrl', () => {
  it('accepts https / http / mailto', () => {
    expect(_isSafeUrl('https://example.com', false)).toBe(true);
    expect(_isSafeUrl('http://example.com', false)).toBe(true);
    expect(_isSafeUrl('mailto:a@b.c', false)).toBe(true);
  });

  it('accepts relative app paths', () => {
    expect(_isSafeUrl('/note/abc', false)).toBe(true);
    expect(_isSafeUrl('#anchor', false)).toBe(true);
  });

  it('rejects javascript: / file: / data: (when image flag off)', () => {
    expect(_isSafeUrl('javascript:alert(1)', false)).toBe(false);
    expect(_isSafeUrl('file:///etc/passwd', false)).toBe(false);
    expect(_isSafeUrl('data:image/png;base64,iVBORw0KG', false)).toBe(false);
  });

  it('accepts image data: URLs only when explicitly allowed', () => {
    expect(_isSafeUrl('data:image/png;base64,iVBORw0KG', true)).toBe(true);
    expect(_isSafeUrl('data:text/html,<script>', true)).toBe(false);
  });

  it('rejects protocol-relative (//evil.com)', () => {
    expect(_isSafeUrl('//evil.com', false)).toBe(false);
  });

  it('rejects empty / over-long', () => {
    expect(_isSafeUrl('', false)).toBe(false);
    expect(_isSafeUrl('https://x.com/' + 'a'.repeat(3000), false)).toBe(false);
  });
});

describe('tokeniseInline', () => {
  it('plain text becomes a single text token', () => {
    expect(_tokeniseInline('hello world')).toEqual([{ kind: 'text', value: 'hello world' }]);
  });

  it('parses **bold**', () => {
    const out = _tokeniseInline('a **bold** c');
    expect(out).toEqual([
      { kind: 'text', value: 'a ' },
      { kind: 'bold', children: [{ kind: 'text', value: 'bold' }] },
      { kind: 'text', value: ' c' },
    ]);
  });

  it('parses *italic*', () => {
    const out = _tokeniseInline('*italic*');
    expect(out[0]).toEqual({ kind: 'italic', children: [{ kind: 'text', value: 'italic' }] });
  });

  it('parses inline `code`', () => {
    const out = _tokeniseInline('foo `bar` baz');
    expect(out[1]).toEqual({ kind: 'code', value: 'bar' });
  });

  it('parses safe links', () => {
    const out = _tokeniseInline('a [docs](https://example.com) b');
    expect(out[1]).toEqual({
      kind: 'link',
      href: 'https://example.com',
      children: [{ kind: 'text', value: 'docs' }],
    });
  });

  it('rejects javascript: links — preserves only the label text', () => {
    const out = _tokeniseInline('click [me](javascript:alert(1))');
    // No link token ever produced.
    expect(out.find((t) => t.kind === 'link')).toBeUndefined();
    // Adjacent text runs are merged into one token — the label "me" survives
    // as text but the executable URL is gone.
    const joined = out.filter((t) => t.kind === 'text').map((t) => (t as { value: string }).value).join('');
    expect(joined).toContain('me');
    expect(joined).not.toContain('javascript:');
  });

  it('refuses non-image data: in image syntax', () => {
    const out = _tokeniseInline('![alt](data:text/html,<script>)');
    expect(out.find((t) => t.kind === 'image')).toBeUndefined();
  });

  it('accepts image data: URLs', () => {
    const out = _tokeniseInline('![pixel](data:image/png;base64,iVBORw0KGgo=)');
    expect(out[0]).toEqual({ kind: 'image', src: 'data:image/png;base64,iVBORw0KGgo=', alt: 'pixel' });
  });
});

describe('tokeniseMarkdown', () => {
  it('returns empty array for empty input', () => {
    expect(tokeniseMarkdown('')).toEqual([]);
  });

  it('parses headings 1-6', () => {
    for (let i = 1; i <= 6; i++) {
      const out = tokeniseMarkdown('#'.repeat(i) + ' title');
      expect(out[0]).toMatchObject({ kind: 'heading', level: i });
    }
  });

  it('parses code-block with language', () => {
    const md = '```ts\nconst x = 1;\n```';
    expect(tokeniseMarkdown(md)).toEqual([
      { kind: 'code-block', language: 'ts', value: 'const x = 1;' },
    ]);
  });

  it('parses thematic break (---/***)', () => {
    expect(tokeniseMarkdown('---')[0].kind).toBe('thematic-break');
    expect(tokeniseMarkdown('***')[0].kind).toBe('thematic-break');
  });

  it('parses unordered + ordered lists', () => {
    const u = tokeniseMarkdown('- a\n- b');
    expect(u[0]).toMatchObject({ kind: 'list', ordered: false });
    const o = tokeniseMarkdown('1. a\n2. b');
    expect(o[0]).toMatchObject({ kind: 'list', ordered: true });
  });

  it('parses blockquote', () => {
    const out = tokeniseMarkdown('> quoted line\n> next');
    expect(out[0].kind).toBe('blockquote');
  });

  it('parses paragraphs across multiple lines', () => {
    const out = tokeniseMarkdown('line one\nline two\n\nline three');
    expect(out).toHaveLength(2);
    expect(out[0].kind).toBe('paragraph');
  });

  it('truncates over-long input', () => {
    const huge = 'a'.repeat(300_000);
    const out = tokeniseMarkdown(huge);
    expect(out.length).toBeGreaterThan(0);
  });
});
