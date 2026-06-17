import {
  parseLockedFlag, hasLockSignal, buildSecurityNoteMap,
  isReadableWithLocks, findBlockingLockedAncestor, filterReadableNotes, maskLockedNote,
  filterReadableForAI, isReadableForAI, relockFoldersOnLeave, AI_INDEX_NO_UNLOCK,
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

describe('AI/index never see locked content (even if the UI unlocked it)', () => {
  const notes = [
    n({ _id: 'proj', locked: true, type: 'project' }),
    n({ _id: 'child', parentId: 'proj', title: 'Secret' }),
    n({ _id: 'free', locked: false, title: 'Public' }),
  ];
  const map = buildSecurityNoteMap(notes);

  it('AI_INDEX_NO_UNLOCK is empty', () => {
    expect(AI_INDEX_NO_UNLOCK.size).toBe(0);
  });

  it('filterReadableForAI drops locked-folder children regardless of UI unlock', () => {
    // Even if the UI has the folder unlocked, the AI helper ignores it.
    expect(filterReadableForAI(notes).map((x) => x._id)).toEqual(['free']);
  });

  it('isReadableForAI blocks a note in a locked folder', () => {
    expect(isReadableForAI(map.get('child'), map)).toBe(false);
    expect(isReadableForAI(map.get('free'), map)).toBe(true);
  });
});

describe('relockFoldersOnLeave (folders re-lock when you navigate away)', () => {
  const notes = [
    n({ _id: 'A', locked: true, type: 'project' }),               // locked folder A
    n({ _id: 'B', locked: true, type: 'project', parentId: 'A' }), // locked subfolder B inside A
    n({ _id: 'C', locked: true, type: 'project' }),               // unrelated locked folder C
    n({ _id: 'note1', parentId: 'A' }),
    n({ _id: 'soloNote', locked: true }),                          // individually unlocked note
  ];

  it('leaving to all-notes (null) re-locks every folder', () => {
    expect(relockFoldersOnLeave(notes, ['A', 'C'], null).sort()).toEqual([]);
  });

  it('keeps the active folder + ancestors, drops the rest', () => {
    // Inside B: keep A (ancestor) + B; drop C.
    expect(relockFoldersOnLeave(notes, ['A', 'B', 'C'], 'B').sort()).toEqual(['A', 'B']);
  });

  it('switching to a sibling folder re-locks the one you left', () => {
    // Was in A, now entering C → A re-locks, C stays (it was just unlocked).
    expect(relockFoldersOnLeave(notes, ['A', 'C'], 'C').sort()).toEqual(['C']);
  });

  it('leaves individually-unlocked NON-folder notes untouched', () => {
    expect(relockFoldersOnLeave(notes, ['A', 'soloNote'], null).sort()).toEqual(['soloNote']);
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
