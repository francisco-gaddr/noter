import {
  setFolderKey,
  getFolderKey,
  hasFolderKey,
  clearFolderKey,
  clearAllFolderKeys,
  unlockedFolderIds,
  folderKeySessionSize,
} from './folderKeySession';

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
