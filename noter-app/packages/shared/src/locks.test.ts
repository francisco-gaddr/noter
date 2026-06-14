import {
  parseLockedFlag, hasLockSignal, buildSecurityNoteMap,
  isReadableWithLocks, findBlockingLockedAncestor, filterReadableNotes, maskLockedNote,
  type SecurityNote,
} from './locks';

const n = (o: Partial<SecurityNote> & { _id: string }): SecurityNote => ({ ...o });

describe('parseLockedFlag', () => {
  it('handles boolean / number / plain strings', () => {
    expect(parseLockedFlag(true)).toBe(true);
    expect(parseLockedFlag(false)).toBe(false);
    expect(parseLockedFlag(1)).toBe(true);
    expect(parseLockedFlag('true')).toBe(true);
    expect(parseLockedFlag('false')).toBe(false);
    expect(parseLockedFlag('')).toBe(false);
    expect(parseLockedFlag(undefined)).toBe(false);
  });
});

describe('hasLockSignal', () => {
  it('treats a set password as a lock signal even without the flag', () => {
    expect(hasLockSignal({ locked: false, password: 'hash' })).toBe(true);
    expect(hasLockSignal({ locked: false, password: '' })).toBe(false);
    expect(hasLockSignal({ locked: true })).toBe(true);
  });
});

describe('isReadableWithLocks (hierarchical)', () => {
  const notes = [
    n({ _id: 'proj', locked: true, type: 'project' }),       // locked folder
    n({ _id: 'child', parentId: 'proj' }),                   // note inside locked folder
    n({ _id: 'free', locked: false }),                       // unlocked standalone
    n({ _id: 'lockedNote', locked: true }),                  // directly locked note
  ];
  const map = buildSecurityNoteMap(notes);

  it('blocks a directly locked note', () => {
    expect(isReadableWithLocks(map.get('lockedNote'), map)).toBe(false);
  });
  it('blocks a note inside a locked folder', () => {
    expect(isReadableWithLocks(map.get('child'), map)).toBe(false);
    expect(findBlockingLockedAncestor(map.get('child'), map)?._id).toBe('proj');
  });
  it('allows an unlocked note', () => {
    expect(isReadableWithLocks(map.get('free'), map)).toBe(true);
  });
  it('allows a locked note once it (or its blocking ancestor) is in unlockedIds', () => {
    expect(isReadableWithLocks(map.get('child'), map, new Set(['proj']))).toBe(true);
    expect(isReadableWithLocks(map.get('lockedNote'), map, new Set(['lockedNote']))).toBe(true);
  });

  it('filterReadableNotes drops the whole locked subtree', () => {
    const readable = filterReadableNotes(notes).map((x) => x._id).sort();
    expect(readable).toEqual(['free']);
  });
});

describe('maskLockedNote', () => {
  it('blanks content/tags and renames non-project notes', () => {
    const masked = maskLockedNote(n({ _id: 'x', title: 'Secret', content: 'shh', tags: ['a'] }));
    expect(masked.content).toBe('');
    expect(masked.tags).toEqual([]);
    expect(masked.title).toBe('Låst anteckning');
    expect(masked.locked).toBe(true);
  });
});
