import {
  parseLockedFlag, hasLockSignal, buildSecurityNoteMap,
  isReadableWithLocks, findBlockingLockedAncestor, filterReadableNotes, maskLockedNote,
  filterReadableForAI, isReadableForAI, relockFoldersOnLeave, AI_INDEX_NO_UNLOCK,
  shouldRelockOnIdle, FOLDER_IDLE_RELOCK_MS,
  resolveFolderIdleLockMs, FOLDER_IDLE_LOCK_OPTIONS_MIN,
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

describe('shouldRelockOnIdle (foreground idle re-lock decision)', () => {
  const T0 = 1_000_000_000_000; // fixed epoch ms; the helper is pure so no real clock is used

  it('stays unlocked before the threshold elapses', () => {
    expect(shouldRelockOnIdle(T0, T0 + FOLDER_IDLE_RELOCK_MS - 1)).toBe(false);
  });

  it('re-locks exactly at and past the threshold', () => {
    expect(shouldRelockOnIdle(T0, T0 + FOLDER_IDLE_RELOCK_MS)).toBe(true);
    expect(shouldRelockOnIdle(T0, T0 + FOLDER_IDLE_RELOCK_MS + 60_000)).toBe(true);
  });

  it('honours a custom threshold', () => {
    expect(shouldRelockOnIdle(T0, T0 + 30_000, 60_000)).toBe(false);
    expect(shouldRelockOnIdle(T0, T0 + 60_000, 60_000)).toBe(true);
  });

  it('treats a non-positive threshold as disabled (never auto-relocks)', () => {
    expect(shouldRelockOnIdle(T0, T0 + 10 * FOLDER_IDLE_RELOCK_MS, 0)).toBe(false);
    expect(shouldRelockOnIdle(T0, T0 + 10 * FOLDER_IDLE_RELOCK_MS, -1)).toBe(false);
  });

  it('never force-locks on a bad/uninitialised clock (non-finite inputs)', () => {
    expect(shouldRelockOnIdle(NaN, T0)).toBe(false);
    expect(shouldRelockOnIdle(T0, NaN)).toBe(false);
    expect(shouldRelockOnIdle(T0, Infinity)).toBe(false);
  });
});

describe('resolveFolderIdleLockMs (persisted user setting → threshold ms)', () => {
  it('maps each offered option (minutes) to milliseconds', () => {
    expect(resolveFolderIdleLockMs(1)).toBe(60_000);
    expect(resolveFolderIdleLockMs(5)).toBe(5 * 60_000);
    expect(resolveFolderIdleLockMs(15)).toBe(15 * 60_000);
    expect(resolveFolderIdleLockMs(30)).toBe(30 * 60_000);
  });

  it('accepts the same value stored as a string (localStorage/SecureStore round-trip)', () => {
    expect(resolveFolderIdleLockMs('5')).toBe(5 * 60_000);
    expect(resolveFolderIdleLockMs('0')).toBe(0);
  });

  it('treats 0 / "Av" as off (0 ms → shouldRelockOnIdle stays false)', () => {
    expect(resolveFolderIdleLockMs(0)).toBe(0);
    expect(shouldRelockOnIdle(0, 10 * FOLDER_IDLE_RELOCK_MS, resolveFolderIdleLockMs(0))).toBe(false);
  });

  it('falls back to the default when unset (null/undefined/empty)', () => {
    expect(resolveFolderIdleLockMs(null)).toBe(FOLDER_IDLE_RELOCK_MS);
    expect(resolveFolderIdleLockMs(undefined)).toBe(FOLDER_IDLE_RELOCK_MS);
    expect(resolveFolderIdleLockMs('')).toBe(FOLDER_IDLE_RELOCK_MS);
  });

  it('rejects a tampered/out-of-range value (cannot widen the window beyond an offered option)', () => {
    expect(resolveFolderIdleLockMs(7)).toBe(FOLDER_IDLE_RELOCK_MS);
    expect(resolveFolderIdleLockMs('999999')).toBe(FOLDER_IDLE_RELOCK_MS);
    expect(resolveFolderIdleLockMs('abc')).toBe(FOLDER_IDLE_RELOCK_MS);
    expect(resolveFolderIdleLockMs(-5)).toBe(FOLDER_IDLE_RELOCK_MS);
  });

  it('every non-zero offered option resolves to a positive threshold that the default sits within', () => {
    for (const min of FOLDER_IDLE_LOCK_OPTIONS_MIN) {
      const ms = resolveFolderIdleLockMs(min);
      if (min === 0) expect(ms).toBe(0);
      else expect(ms).toBe(min * 60_000);
    }
    expect(FOLDER_IDLE_LOCK_OPTIONS_MIN).toContain(FOLDER_IDLE_RELOCK_MS / 60_000);
  });
});
