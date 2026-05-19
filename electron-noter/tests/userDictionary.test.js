const { addWord, removeWord, reconcileWords, sanitiseWord } = require('../src/userDictionary');

describe('sanitiseWord', () => {
  it('trims whitespace', () => {
    expect(sanitiseWord('  hello  ')).toBe('hello');
  });

  it('rejects non-string / empty / over-long', () => {
    expect(sanitiseWord(null)).toBeNull();
    expect(sanitiseWord('')).toBeNull();
    expect(sanitiseWord('x'.repeat(100))).toBeNull();
  });

  it('accepts Unicode letters (åäö, accents, Cyrillic)', () => {
    expect(sanitiseWord('Göteborg')).toBe('Göteborg');
    expect(sanitiseWord('Привет')).toBe('Привет');
  });

  it('accepts hyphens and apostrophes', () => {
    expect(sanitiseWord("don't")).toBe("don't");
    expect(sanitiseWord('e-mail')).toBe('e-mail');
  });

  it('rejects whitespace and punctuation in the middle', () => {
    expect(sanitiseWord('hello world')).toBeNull();
    expect(sanitiseWord('foo.bar')).toBeNull();
  });

  it('preserves case', () => {
    expect(sanitiseWord('iPhone')).toBe('iPhone');
  });
});

describe('addWord', () => {
  it('adds a new word', () => {
    const out = addWord([], 'hello');
    expect(out.ok).toBe(true);
    expect(out.list).toEqual(['hello']);
    expect(out.alreadyPresent).toBe(false);
  });

  it('detects duplicates as already-present', () => {
    const out = addWord(['hello'], 'hello');
    expect(out.ok).toBe(true);
    expect(out.alreadyPresent).toBe(true);
    expect(out.list).toEqual(['hello']);
  });

  it('rejects invalid words', () => {
    const out = addWord([], 'with space');
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('invalid-word');
  });

  it('caps the list at 5000 entries', () => {
    const big = Array.from({ length: 5000 }, (_, i) => `word${i}`);
    const out = addWord(big, 'wordNew');
    expect(out.ok).toBe(true);
    expect(out.list).toHaveLength(5000);
    expect(out.list.includes('wordNew')).toBe(true);
  });
});

describe('removeWord', () => {
  it('removes existing word', () => {
    const out = removeWord(['a', 'b', 'c'], 'b');
    expect(out.ok).toBe(true);
    expect(out.list).toEqual(['a', 'c']);
  });

  it('no-op when word is absent', () => {
    const out = removeWord(['a', 'b'], 'c');
    expect(out.list).toEqual(['a', 'b']);
  });

  it('rejects invalid input', () => {
    expect(removeWord([], '').ok).toBe(false);
  });
});

describe('reconcileWords', () => {
  it('returns empty array for non-array input', () => {
    expect(reconcileWords(null)).toEqual([]);
    expect(reconcileWords('foo')).toEqual([]);
  });

  it('drops invalid entries', () => {
    expect(reconcileWords(['ok', 'with space', '', 'fine'])).toEqual(['ok', 'fine']);
  });

  it('dedupes case-sensitively', () => {
    expect(reconcileWords(['Apple', 'apple', 'Apple'])).toEqual(['Apple', 'apple']);
  });

  it('caps to 5000', () => {
    const big = Array.from({ length: 6000 }, (_, i) => `w${i}`);
    expect(reconcileWords(big).length).toBe(5000);
  });
});
