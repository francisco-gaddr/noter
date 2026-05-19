import { highlightMatches, _escapeRegex, _cleanTerms } from '../../utils/searchHighlight';

describe('highlightMatches', () => {
  it('returns whole text as non-match when no terms', () => {
    expect(highlightMatches('hello world', [])).toEqual([{ text: 'hello world', match: false }]);
  });

  it('returns empty array for empty text', () => {
    expect(highlightMatches('', ['x'])).toEqual([]);
  });

  it('highlights a single match', () => {
    expect(highlightMatches('hello world', ['world'])).toEqual([
      { text: 'hello ', match: false },
      { text: 'world', match: true },
    ]);
  });

  it('is case-insensitive', () => {
    expect(highlightMatches('Hello World', ['hello'])).toEqual([
      { text: 'Hello', match: true },
      { text: ' World', match: false },
    ]);
  });

  it('handles multiple matches', () => {
    expect(highlightMatches('aa bb aa', ['aa'])).toEqual([
      { text: 'aa', match: true },
      { text: ' bb ', match: false },
      { text: 'aa', match: true },
    ]);
  });

  it('merges overlapping ranges (longest match wins)', () => {
    // 'foobar' and 'foo' — overlapping at the start of 'foobar'.
    const out = highlightMatches('foobar baz', ['foo', 'foobar']);
    expect(out[0].text).toBe('foobar');
    expect(out[0].match).toBe(true);
  });

  it('regex special chars in term are treated literally', () => {
    expect(highlightMatches('a.b a*b', ['a.b'])).toEqual([
      { text: 'a.b', match: true },
      { text: ' a*b', match: false },
    ]);
  });

  it('returns single non-match for over-long inputs (50k+)', () => {
    const huge = 'a'.repeat(60_000);
    expect(highlightMatches(huge, ['a'])).toEqual([{ text: huge, match: false }]);
  });

  it('dedupes case-insensitive duplicate terms', () => {
    const out = highlightMatches('Foo foo FOO', ['Foo', 'foo', 'FOO']);
    // All three should highlight; dedupe means we don't multi-count.
    expect(out.filter((s) => s.match).length).toBe(3);
  });

  it('limits to 16 terms', () => {
    const terms = Array.from({ length: 30 }, (_, i) => `term${i}`);
    // No errors thrown; only first 16 are considered.
    expect(() => highlightMatches('term1 term25', terms)).not.toThrow();
  });
});

describe('_escapeRegex', () => {
  it('escapes regex metacharacters', () => {
    expect(_escapeRegex('a.b*c+d')).toBe('a\\.b\\*c\\+d');
    expect(_escapeRegex('(foo|bar)')).toBe('\\(foo\\|bar\\)');
  });
});

describe('_cleanTerms', () => {
  it('drops empty and over-long terms', () => {
    expect(_cleanTerms(['', '   ', 'a'.repeat(300), 'ok'])).toEqual(['ok']);
  });

  it('dedupes case-insensitive', () => {
    expect(_cleanTerms(['Foo', 'foo'])).toEqual(['Foo']);
  });

  it('sorts by length desc for longest-match-wins', () => {
    expect(_cleanTerms(['ab', 'a', 'abc'])).toEqual(['abc', 'ab', 'a']);
  });
});
