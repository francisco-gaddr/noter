import {
  createFolderKey,
  unlockFolderKey,
  rewrapFolderKey,
  wrapNoteForFolder,
  unwrapNoteForFolder,
  isFolderWrapped,
  parseFolderKeyBundle,
  serializeFolderKeyBundle,
  deserializeFolderKeyBundle,
  FolderUnlockError,
  FOLDER_CONTENT_PREFIX,
  type FolderKeyBundle,
} from './folderKey';
import { isV3, generateDataKey, type KdfId } from './cryptoV3';

const PW = 'correct horse battery staple';
// Keep the per-test KDF cheap: Argon2id (the production default) is memory-hard and ~seconds per
// call in the pure-JS test runtime. The wrap/unwrap LOGIC is KDF-agnostic, so we exercise it via
// PBKDF2 and keep a single Argon2id smoke test below to prove the real default path works.
const FAST: KdfId = 'pbkdf2-sha256';

describe('folderKey — enrol + unlock', () => {
  let base: Awaited<ReturnType<typeof createFolderKey>>;
  beforeAll(async () => {
    base = await createFolderKey(PW, FAST);
  });

  it('unlocks with the right password and yields the same folder key', async () => {
    expect(await unlockFolderKey(PW, base.bundle)).toEqual(base.folderKey);
  });

  it('works with the production default (argon2id) KDF too', async () => {
    const { bundle, folderKey } = await createFolderKey(PW); // no override → argon2id
    expect(bundle.kdf).toBe('argon2id');
    expect(await unlockFolderKey(PW, bundle)).toEqual(folderKey);
  });

  it('persists no usable secret: bundle is only salt + kdf + a v3w wrapped key', () => {
    expect(base.bundle.v).toBe(1);
    expect(typeof base.bundle.salt).toBe('string');
    expect(base.bundle.kdf).toBe('pbkdf2-sha256');
    expect(base.bundle.wrappedKey.startsWith('v3w:')).toBe(true);
    expect(base.bundle.wrappedKey).not.toContain('v3f:');
  });

  it('rejects the wrong password with FolderUnlockError (never returns a key)', async () => {
    await expect(unlockFolderKey('wrong password', base.bundle)).rejects.toBeInstanceOf(FolderUnlockError);
  });

  it('rejects an empty password', async () => {
    await expect(unlockFolderKey('', base.bundle)).rejects.toBeInstanceOf(FolderUnlockError);
    await expect(createFolderKey('')).rejects.toThrow();
  });

  it('rejects a tampered wrapped key (auth-tag failure → FolderUnlockError)', async () => {
    const body = base.bundle.wrappedKey.slice('v3w:'.length);
    const flipped = (body[5] === 'A' ? 'B' : 'A') + body.slice(1);
    const tampered: FolderKeyBundle = { ...base.bundle, wrappedKey: 'v3w:' + flipped };
    await expect(unlockFolderKey(PW, tampered)).rejects.toBeInstanceOf(FolderUnlockError);
  });

  it('gives every folder an independent salt and key', async () => {
    const other = await createFolderKey(PW, FAST); // same password, different folder
    expect(other.bundle.salt).not.toBe(base.bundle.salt);
    expect(other.folderKey).not.toEqual(base.folderKey);
  });
});

describe('folderKey — note content wrapping (KDF-free; raw keys)', () => {
  const key = generateDataKey();
  const key2 = generateDataKey();

  it('round-trips a note field through the folder key', () => {
    const plaintext = 'Hemlig anteckning 🔐 with åäö';
    const sealed = wrapNoteForFolder(plaintext, key);
    expect(isFolderWrapped(sealed)).toBe(true);
    expect(sealed.startsWith(FOLDER_CONTENT_PREFIX)).toBe(true);
    expect(unwrapNoteForFolder(sealed, key)).toBe(plaintext);
  });

  it('a folder-wrapped value is NOT a plain v3 envelope (read path can dispatch)', () => {
    const sealed = wrapNoteForFolder('x', key);
    expect(isFolderWrapped(sealed)).toBe(true);
    expect(isV3(sealed)).toBe(false); // v3f: does not start with v3:
  });

  it('cannot be opened by a different folder key', () => {
    const sealed = wrapNoteForFolder('secret', key);
    expect(() => unwrapNoteForFolder(sealed, key2)).toThrow();
  });

  it('rejects tampered ciphertext', () => {
    const sealed = wrapNoteForFolder('secret', key);
    const body = sealed.slice(FOLDER_CONTENT_PREFIX.length);
    const tampered = FOLDER_CONTENT_PREFIX + (body[3] === 'A' ? 'B' : 'A') + body.slice(1);
    expect(() => unwrapNoteForFolder(tampered, key)).toThrow();
  });

  it('refuses to open a non-v3f value', () => {
    expect(() => unwrapNoteForFolder('v3:not-a-folder-envelope', key)).toThrow();
    expect(() => unwrapNoteForFolder('plaintext', key)).toThrow();
  });

  it('isFolderWrapped is false for non-v3f and non-string inputs', () => {
    expect(isFolderWrapped('v3:abc')).toBe(false);
    expect(isFolderWrapped('plain')).toBe(false);
    expect(isFolderWrapped(null)).toBe(false);
    expect(isFolderWrapped(123)).toBe(false);
  });

  it('handles empty string content', () => {
    const sealed = wrapNoteForFolder('', key);
    expect(unwrapNoteForFolder(sealed, key)).toBe('');
  });
});

describe('folderKey — password change (re-wrap, no re-encryption)', () => {
  it('re-wraps the SAME key under a new password; old notes still decrypt; old password stops working', async () => {
    const { bundle, folderKey } = await createFolderKey(PW, FAST);
    const sealed = wrapNoteForFolder('keep me readable', folderKey);

    const newBundle = await rewrapFolderKey(folderKey, 'a brand new passphrase', FAST);

    const reopened = await unlockFolderKey('a brand new passphrase', newBundle);
    expect(reopened).toEqual(folderKey);
    // The note sealed before the change is still readable (no re-encryption needed).
    expect(unwrapNoteForFolder(sealed, reopened)).toBe('keep me readable');
    // The old password no longer opens the NEW bundle, and a fresh salt was used.
    await expect(unlockFolderKey(PW, newBundle)).rejects.toBeInstanceOf(FolderUnlockError);
    expect(newBundle.salt).not.toBe(bundle.salt);
  });

  it('rewrapFolderKey rejects an empty password or invalid key', async () => {
    const { folderKey } = await createFolderKey(PW, FAST);
    await expect(rewrapFolderKey(folderKey, '', FAST)).rejects.toThrow();
    await expect(rewrapFolderKey(new Uint8Array(0), 'pw', FAST)).rejects.toThrow();
  });
});

describe('folderKey — bundle (de)serialisation + validation', () => {
  let bundle: FolderKeyBundle;
  beforeAll(async () => {
    bundle = (await createFolderKey(PW, FAST)).bundle;
  });

  it('parses a valid bundle and rejects malformed ones', () => {
    expect(parseFolderKeyBundle(bundle)).toEqual(bundle);
    expect(parseFolderKeyBundle(null)).toBeNull();
    expect(parseFolderKeyBundle('nope')).toBeNull();
    expect(parseFolderKeyBundle({ ...bundle, v: 2 })).toBeNull();
    expect(parseFolderKeyBundle({ ...bundle, salt: '' })).toBeNull();
    expect(parseFolderKeyBundle({ ...bundle, kdf: 'md5' })).toBeNull();
    expect(parseFolderKeyBundle({ ...bundle, wrappedKey: 'v3:not-wrapped' })).toBeNull();
  });

  it('serialise → deserialise round-trips; deserialise rejects junk', () => {
    const s = serializeFolderKeyBundle(bundle);
    expect(typeof s).toBe('string');
    expect(deserializeFolderKeyBundle(s)).toEqual(bundle);
    expect(deserializeFolderKeyBundle('not json {')).toBeNull();
    expect(deserializeFolderKeyBundle(42)).toBeNull();
    expect(deserializeFolderKeyBundle(JSON.stringify({ v: 1 }))).toBeNull();
  });
});
