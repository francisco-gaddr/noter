const { pushRecent, sanitiseList, buildRecentMenuTemplate, MAX_ENTRIES } = require('../src/recentNotes');

describe('pushRecent', () => {
  it('adds a new entry at the front', () => {
    const out = pushRecent([], { id: 'a', title: 'Alpha' });
    expect(out).toEqual([{ id: 'a', title: 'Alpha' }]);
  });

  it('deduplicates by id (moves existing to front)', () => {
    const list = [
      { id: 'a', title: 'Alpha' },
      { id: 'b', title: 'Beta' },
    ];
    const out = pushRecent(list, { id: 'b', title: 'Beta v2' });
    expect(out).toEqual([
      { id: 'b', title: 'Beta v2' },
      { id: 'a', title: 'Alpha' },
    ]);
  });

  it('caps at MAX_ENTRIES (5)', () => {
    const list = Array.from({ length: 10 }, (_, i) => ({ id: `n${i}`, title: `N${i}` }));
    const out = pushRecent(list, { id: 'new', title: 'New' });
    expect(out).toHaveLength(MAX_ENTRIES);
    expect(out[0]).toEqual({ id: 'new', title: 'New' });
  });

  it('rejects entries with invalid id', () => {
    expect(pushRecent([], { id: '', title: 'x' })).toEqual([]);
    expect(pushRecent([], { id: 'a b', title: 'x' })).toEqual([]);
    expect(pushRecent([], { id: 'a\nb', title: 'x' })).toEqual([]);
  });

  it('rejects ids longer than 64 chars', () => {
    const longId = 'a'.repeat(100);
    expect(pushRecent([], { id: longId, title: 'x' })).toEqual([]);
  });

  it('replaces missing title with "Untitled"', () => {
    expect(pushRecent([], { id: 'a' }).map((e) => e.title)).toEqual(['Untitled']);
    expect(pushRecent([], { id: 'a', title: '' }).map((e) => e.title)).toEqual(['Untitled']);
  });

  it('truncates long titles with an ellipsis', () => {
    const out = pushRecent([], { id: 'a', title: 'x'.repeat(100) });
    expect(out[0].title.length).toBeLessThanOrEqual(64);
    expect(out[0].title.endsWith('…')).toBe(true);
  });

  it('strips control characters from title (no \\n in menu labels)', () => {
    const out = pushRecent([], { id: 'a', title: 'multi\nline\tnote' });
    expect(out[0].title).toBe('multilinenote');
  });
});

describe('sanitiseList', () => {
  it('returns empty array for non-array input', () => {
    expect(sanitiseList(null)).toEqual([]);
    expect(sanitiseList('not-an-array')).toEqual([]);
  });

  it('drops invalid entries and dedupes', () => {
    const out = sanitiseList([
      { id: 'a', title: 'A' },
      { id: '', title: 'broken' },
      { id: 'a', title: 'dup' },
      null,
      { id: 'b', title: 'B' },
    ]);
    expect(out.map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('caps at MAX_ENTRIES', () => {
    const input = Array.from({ length: 10 }, (_, i) => ({ id: `n${i}`, title: `N${i}` }));
    expect(sanitiseList(input)).toHaveLength(MAX_ENTRIES);
  });
});

describe('buildRecentMenuTemplate', () => {
  it('returns a disabled "No recent notes" entry when list is empty', () => {
    const tpl = buildRecentMenuTemplate([], { onOpen: jest.fn() });
    expect(tpl).toEqual([{ label: 'No recent notes', enabled: false }]);
  });

  it('builds clickable entries that invoke onOpen with the id', () => {
    const onOpen = jest.fn();
    const tpl = buildRecentMenuTemplate(
      [{ id: 'a', title: 'Alpha' }, { id: 'b', title: 'Beta' }],
      { onOpen }
    );
    expect(tpl.map((t) => t.label)).toEqual(['Alpha', 'Beta']);
    tpl[0].click();
    tpl[1].click();
    expect(onOpen).toHaveBeenNthCalledWith(1, 'a');
    expect(onOpen).toHaveBeenNthCalledWith(2, 'b');
  });
});
