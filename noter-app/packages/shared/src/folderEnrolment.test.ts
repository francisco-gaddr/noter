import {
  enrolFolderPassword,
  unlockFolderWithPassword,
  changeFolderPassword,
  lockFolder,
  isFolderUnlocked,
  folderCryptoStatus,
} from './folderEnrolment';
import { getFolderKey, hasFolderKey, clearAllFolderKeys, setFolderKey } from './folderKeySession';
import {
  unlockFolderKey,
  readFolderKeyBundleFromNote,
  wrapNoteForFolder,
  unwrapNoteForFolder,
  createFolderKey,
  serializeFolderKeyBundle,
  FolderUnlockError,
} from './folderKey';

const PW = 'rätt-lösen-åäö';
// Keep the KDF cost out of the suite: pbkdf2 derives in ms where argon2id takes ~7.5s. The argon2id
// path itself is smoke-tested in folderKey.test.ts; here we exercise the orchestration, not the KDF.
const FAST = 'pbkdf2-sha256' as const;

type FolderNote = { _id: string; title: string; folderKeyBundle?: string };
const makeFolder = (id = 'fld-1'): FolderNote => ({ _id: id, title: 'Hemlig mapp' });

afterEach(() => clearAllFolderKeys()); // never leak a session key between tests

describe('folderEnrolment — enrol', () => {
  it('mints a key, registers the session, and stamps a persistable bundle on a note COPY', async () => {
    const folder = makeFolder();
    const { note, bundle } = await enrolFolderPassword('fld-1', folder, PW, FAST);
    // returned note is a copy carrying the bundle; the input note is never mutated
    expect(note.folderKeyBundle).toBeTruthy();
    expect(folder.folderKeyBundle).toBeUndefined();
    expect(readFolderKeyBundleFromNote(note)).toEqual(bundle);
    // the session holds exactly the key the bundle unlocks to
    expect(hasFolderKey('fld-1')).toBe(true);
    const fromBundle = await unlockFolderKey(PW, bundle);
    expect(Array.from(getFolderKey('fld-1')!)).toEqual(Array.from(fromBundle));
  });

  it('REFUSES to re-enrol an already-enrolled folder (would orphan its notes) and leaves the session untouched', async () => {
    const { note } = await enrolFolderPassword('fld-1', makeFolder(), PW, FAST);
    clearAllFolderKeys();
    await expect(enrolFolderPassword('fld-1', note, 'annat-lösen', FAST)).rejects.toThrow(
      /already enrolled/,
    );
    expect(hasFolderKey('fld-1')).toBe(false); // the rejected re-enrol minted no key
  });

  it('rejects a blank password and a missing folderId', async () => {
    await expect(enrolFolderPassword('fld-1', makeFolder(), '', FAST)).rejects.toThrow();
    await expect(enrolFolderPassword('', makeFolder(), PW, FAST)).rejects.toThrow(/folderId/);
  });
});

describe('folderEnrolment — unlock', () => {
  it('restores the SAME session key from the right password after a relock', async () => {
    const { note } = await enrolFolderPassword('fld-1', makeFolder(), PW, FAST);
    const enrolled = getFolderKey('fld-1')!.slice();
    clearAllFolderKeys();
    expect(hasFolderKey('fld-1')).toBe(false);
    await unlockFolderWithPassword('fld-1', note, PW);
    expect(Array.from(getFolderKey('fld-1')!)).toEqual(Array.from(enrolled));
  });

  it('throws FolderUnlockError on the wrong password and leaves the session locked', async () => {
    const { note } = await enrolFolderPassword('fld-1', makeFolder(), PW, FAST);
    clearAllFolderKeys();
    await expect(unlockFolderWithPassword('fld-1', note, 'fel-lösen')).rejects.toBeInstanceOf(
      FolderUnlockError,
    );
    expect(hasFolderKey('fld-1')).toBe(false);
  });

  it('throws FolderUnlockError for a folder that was never enrolled (no/absent bundle)', async () => {
    await expect(unlockFolderWithPassword('fld-1', makeFolder(), PW)).rejects.toBeInstanceOf(
      FolderUnlockError,
    );
    await expect(unlockFolderWithPassword('fld-1', null, PW)).rejects.toBeInstanceOf(
      FolderUnlockError,
    );
  });
});

describe('folderEnrolment — change password', () => {
  it('rotates the wrapper, keeps the SAME key, and invalidates the old password', async () => {
    const { note, bundle: b1 } = await enrolFolderPassword('fld-1', makeFolder(), PW, FAST);
    const key1 = getFolderKey('fld-1')!.slice();
    const NEW = 'nytt-lösen-123';
    const { note: note2, bundle: b2 } = await changeFolderPassword('fld-1', note, PW, NEW, FAST);
    // new bundle has a fresh salt + wrapper ...
    expect(b2.salt).not.toBe(b1.salt);
    expect(b2.wrappedKey).not.toBe(b1.wrappedKey);
    // ... but unwraps to the SAME folder key (no note is re-encrypted)
    expect(Array.from(await unlockFolderKey(NEW, b2))).toEqual(Array.from(key1));
    // the old password no longer opens the new bundle
    await expect(unlockFolderKey(PW, b2)).rejects.toBeInstanceOf(FolderUnlockError);
    // the returned note carries the new bundle for the caller to persist
    expect(readFolderKeyBundleFromNote(note2)).toEqual(b2);
  });

  it('throws on the wrong old password and on an un-enrolled folder (no silent re-key)', async () => {
    const { note } = await enrolFolderPassword('fld-1', makeFolder(), PW, FAST);
    await expect(
      changeFolderPassword('fld-1', note, 'fel-gammalt', 'nytt', FAST),
    ).rejects.toBeInstanceOf(FolderUnlockError);
    await expect(
      changeFolderPassword('fld-1', makeFolder(), PW, 'nytt', FAST),
    ).rejects.toBeInstanceOf(FolderUnlockError);
  });
});

describe('folderEnrolment — end-to-end (enrol → seal → relock → unlock → read)', () => {
  it('a note sealed under the session key is unreadable after relock and readable again after unlock', async () => {
    const { note } = await enrolFolderPassword('fld-1', makeFolder(), PW, FAST);
    // seal a field under the live session key — exactly what the save path (sealNoteFieldForWrite) does
    const sealed = wrapNoteForFolder('Mitt hemliga innehåll åäö', getFolderKey('fld-1')!);
    // relock: the key is gone, so the field cannot be opened at all
    lockFolder('fld-1');
    expect(isFolderUnlocked('fld-1')).toBe(false);
    expect(getFolderKey('fld-1')).toBeUndefined();
    // re-enter the password → the same key is restored → the field reads back
    await unlockFolderWithPassword('fld-1', note, PW);
    expect(unwrapNoteForFolder(sealed, getFolderKey('fld-1')!)).toBe('Mitt hemliga innehåll åäö');
  });
});

describe('folderCryptoStatus — UI menu/gating query', () => {
  it("returns 'plain' for a folder that is not enrolled (no/invalid bundle), null, or malformed", () => {
    expect(folderCryptoStatus({ _id: 'cf', title: 'Vanlig mapp' } as any)).toBe('plain');
    expect(folderCryptoStatus(null)).toBe('plain');
    expect(folderCryptoStatus(undefined)).toBe('plain');
    expect(folderCryptoStatus({ _id: 'cf', folderKeyBundle: 'inte-json {' } as any)).toBe('plain');
    expect(folderCryptoStatus({ _id: 'cf', folderKeyBundle: JSON.stringify({ v: 9 }) } as any)).toBe('plain');
  });

  it("returns 'locked' when enrolled but the folder key is not in the session", async () => {
    const { bundle } = await createFolderKey('lösen', 'pbkdf2-sha256');
    const folder = { _id: 'cf', folderKeyBundle: serializeFolderKeyBundle(bundle) } as any;
    expect(folderCryptoStatus(folder)).toBe('locked');
    // enrolled but no `_id` to check the session against → still 'locked', never throws
    expect(folderCryptoStatus({ folderKeyBundle: serializeFolderKeyBundle(bundle) } as any)).toBe('locked');
  });

  it("returns 'unlocked' once the folder key is in the session, and back to 'locked' after relock", async () => {
    const { bundle, folderKey } = await createFolderKey('lösen', 'pbkdf2-sha256');
    const folder = { _id: 'cf', folderKeyBundle: serializeFolderKeyBundle(bundle) } as any;
    setFolderKey('cf', folderKey);
    expect(folderCryptoStatus(folder)).toBe('unlocked');
    clearAllFolderKeys();
    expect(folderCryptoStatus(folder)).toBe('locked');
  });
});
