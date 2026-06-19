import {
  setFolderKey,
  getFolderKey,
  hasFolderKey,
  clearFolderKey,
  clearAllFolderKeys,
  unlockedFolderIds,
  folderKeySessionSize,
  resolveSessionFolderKeyForNote,
  resolveSessionFolderKeyForNewNote,
  configureFolderKeyTtl,
  sweepExpiredFolderKeys,
  DEFAULT_FOLDER_KEY_TTL_MS,
} from './folderKeySession';
import { buildSecurityNoteMap } from './locks';

const key = (n: number) => new Uint8Array(32).fill(n);

afterEach(() => clearAllFolderKeys()); // never leak session state between tests

describe('folderKeySession — set / get / has', () => {
  it('round-trips a stored key', () => {
    setFolderKey('f1', key(7));
    expect(getFolderKey('f1')).toEqual(key(7));
    expect(hasFolderKey('f1')).toBe(true);
    expect(folderKeySessionSize()).toBe(1);
  });

  it('returns undefined / false for an unknown folder', () => {
    expect(getFolderKey('nope')).toBeUndefined();
    expect(hasFolderKey('nope')).toBe(false);
  });

  it('owns a copy: mutating the caller’s key afterwards does not change the stored key', () => {
    const original = key(3);
    setFolderKey('f1', original);
    original.fill(99); // caller mutates their array
    expect(getFolderKey('f1')).toEqual(key(3)); // stored copy is unaffected
  });

  it('replacing a key keeps the newest value', () => {
    setFolderKey('f1', key(1));
    setFolderKey('f1', key(2));
    expect(getFolderKey('f1')).toEqual(key(2));
    expect(folderKeySessionSize()).toBe(1);
  });
});

describe('folderKeySession — clearing (re-lock)', () => {
  it('clearFolderKey removes one folder; others stay', () => {
    setFolderKey('a', key(1));
    setFolderKey('b', key(2));
    clearFolderKey('a');
    expect(getFolderKey('a')).toBeUndefined();
    expect(hasFolderKey('a')).toBe(false);
    expect(getFolderKey('b')).toEqual(key(2));
    expect(folderKeySessionSize()).toBe(1);
  });

  it('clearFolderKey is a no-op for an unknown / invalid id', () => {
    setFolderKey('a', key(1));
    expect(() => clearFolderKey('unknown')).not.toThrow();
    expect(() => clearFolderKey('')).not.toThrow();
    expect(folderKeySessionSize()).toBe(1);
  });

  it('clearAllFolderKeys empties the whole session (app-lock / logout)', () => {
    setFolderKey('a', key(1));
    setFolderKey('b', key(2));
    setFolderKey('c', key(3));
    clearAllFolderKeys();
    expect(folderKeySessionSize()).toBe(0);
    expect(getFolderKey('a')).toBeUndefined();
    expect(unlockedFolderIds()).toEqual([]);
  });
});

describe('folderKeySession — diagnostics + input validation', () => {
  it('unlockedFolderIds lists ids (no secret material)', () => {
    setFolderKey('a', key(1));
    setFolderKey('b', key(2));
    expect(unlockedFolderIds().sort()).toEqual(['a', 'b']);
  });

  it('setFolderKey rejects an empty id or an empty/invalid key', () => {
    expect(() => setFolderKey('', key(1))).toThrow();
    expect(() => setFolderKey('f1', new Uint8Array(0))).toThrow();
    // @ts-expect-error — deliberately wrong type to prove the runtime guard
    expect(() => setFolderKey('f1', 'not-bytes')).toThrow();
    expect(folderKeySessionSize()).toBe(0);
  });

  it('getFolderKey / hasFolderKey are safe on a non-string id', () => {
    // @ts-expect-error — runtime guard on bad input
    expect(getFolderKey(null)).toBeUndefined();
    // @ts-expect-error
    expect(hasFolderKey(undefined)).toBe(false);
  });
});

describe('resolveSessionFolderKeyForNote — single source for "which folder key governs this note"', () => {
  // A (crypto folder) ⊃ B (folder) ⊃ n2 ;  A ⊃ n1 ;  n0 is a free note.
  type N = { _id: string; parentId?: string | null; locked?: boolean };
  const notes: N[] = [
    { _id: 'A', locked: true },
    { _id: 'B', parentId: 'A', locked: true },
    { _id: 'n0', locked: false },
    { _id: 'n1', parentId: 'A', locked: false },
    { _id: 'n2', parentId: 'B', locked: false },
  ];
  const map = buildSecurityNoteMap(notes);
  const byId = (id: string) => notes.find((n) => n._id === id)!;

  it('returns undefined for a note with no locked ancestor (ordinary note → dataKey path)', () => {
    expect(resolveSessionFolderKeyForNote(byId('n0'), map)).toBeUndefined();
  });

  it('returns undefined when the locked ancestor has no session key (masked, not unlocked)', () => {
    expect(resolveSessionFolderKeyForNote(byId('n1'), map)).toBeUndefined();
  });

  it('returns the ancestor folder’s key once that folder is unlocked in the session', () => {
    setFolderKey('A', key(5));
    expect(resolveSessionFolderKeyForNote(byId('n1'), map)).toEqual(key(5));
  });

  it('resolves the NEAREST locked ancestor: a note in B (no key) inside A (keyed) stays masked', () => {
    setFolderKey('A', key(5));
    expect(resolveSessionFolderKeyForNote(byId('n2'), map)).toBeUndefined(); // nearest is B, unkeyed
    setFolderKey('B', key(6));
    expect(resolveSessionFolderKeyForNote(byId('n2'), map)).toEqual(key(6)); // now B is unlocked
  });

  it('is safe on an undefined note (no throw → undefined)', () => {
    expect(resolveSessionFolderKeyForNote(undefined, map)).toBeUndefined();
  });
});

describe('resolveSessionFolderKeyForNewNote — create-time resolution (note not in the map yet)', () => {
  type N = { _id: string; parentId?: string | null; locked?: boolean };
  const notes: N[] = [
    { _id: 'A', locked: true },
    { _id: 'B', parentId: 'A', locked: true },
    { _id: 'plain', locked: false }, // an ordinary (unlocked) folder
  ];

  it('returns undefined for a root-level note (no parent → no folder)', () => {
    expect(resolveSessionFolderKeyForNewNote(null, notes)).toBeUndefined();
    expect(resolveSessionFolderKeyForNewNote(undefined, notes)).toBeUndefined();
  });

  it('returns undefined when the parent folder is not crypto-locked', () => {
    expect(resolveSessionFolderKeyForNewNote('plain', notes)).toBeUndefined();
  });

  it('returns undefined when the parent crypto folder has no session key', () => {
    expect(resolveSessionFolderKeyForNewNote('A', notes)).toBeUndefined();
  });

  it('returns the parent folder’s key once it is unlocked in the session', () => {
    setFolderKey('A', key(8));
    expect(resolveSessionFolderKeyForNewNote('A', notes)).toEqual(key(8));
    // a note created in subfolder B resolves to the nearest keyed ancestor only when B itself is keyed
    expect(resolveSessionFolderKeyForNewNote('B', notes)).toBeUndefined();
    setFolderKey('B', key(9));
    expect(resolveSessionFolderKeyForNewNote('B', notes)).toEqual(key(9));
  });

  it('returns undefined for an unknown parentId (stale reference, no throw)', () => {
    setFolderKey('A', key(8));
    expect(resolveSessionFolderKeyForNewNote('ghost', notes)).toBeUndefined();
  });
});

describe('folderKeySession — absolute TTL (defense-in-depth backstop)', () => {
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(0); });
  afterEach(() => { configureFolderKeyTtl(DEFAULT_FOLDER_KEY_TTL_MS); jest.useRealTimers(); });

  it('lazily evicts a key on access once its TTL has lapsed', () => {
    configureFolderKeyTtl(1000);
    setFolderKey('f1', key(4));
    jest.advanceTimersByTime(999);
    expect(hasFolderKey('f1')).toBe(true); // still inside the window
    jest.advanceTimersByTime(2); // now past 1000ms
    expect(getFolderKey('f1')).toBeUndefined();
    expect(hasFolderKey('f1')).toBe(false);
    expect(folderKeySessionSize()).toBe(0); // gone, not just hidden
  });

  it('masks an expired key at the note-resolution read path too', () => {
    type N = { _id: string; parentId?: string | null; locked?: boolean };
    const notes: N[] = [{ _id: 'A', locked: true }, { _id: 'n1', parentId: 'A', locked: false }];
    const map = buildSecurityNoteMap(notes);
    configureFolderKeyTtl(500);
    setFolderKey('A', key(5));
    expect(resolveSessionFolderKeyForNote(notes[1], map)).toEqual(key(5));
    jest.advanceTimersByTime(600);
    expect(resolveSessionFolderKeyForNote(notes[1], map)).toBeUndefined();
  });

  it('sweepExpiredFolderKeys drops only the lapsed keys', () => {
    configureFolderKeyTtl(1000);
    setFolderKey('a', key(1));
    jest.advanceTimersByTime(600);
    setFolderKey('b', key(2)); // stamped 600ms later, so it outlives 'a'
    jest.advanceTimersByTime(500); // t=1100: a (exp 1000) lapsed, b (exp 1600) live
    expect(sweepExpiredFolderKeys()).toBe(1);
    expect(hasFolderKey('a')).toBe(false);
    expect(hasFolderKey('b')).toBe(true);
  });

  it('re-storing a key refreshes its expiry (a fresh unlock resets the clock)', () => {
    configureFolderKeyTtl(1000);
    setFolderKey('f1', key(1));
    jest.advanceTimersByTime(900);
    setFolderKey('f1', key(2)); // new TTL window starts here
    jest.advanceTimersByTime(900); // 1800ms absolute, only 900ms since the refresh
    expect(getFolderKey('f1')).toEqual(key(2));
  });

  it('TTL <= 0 disables expiry (keys persist for the whole session)', () => {
    configureFolderKeyTtl(0);
    setFolderKey('f1', key(1));
    jest.advanceTimersByTime(10 * 60 * 60 * 1000); // 10 hours
    expect(getFolderKey('f1')).toEqual(key(1));
  });
});
