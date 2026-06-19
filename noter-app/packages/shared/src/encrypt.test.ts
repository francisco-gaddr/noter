import {
  encrypt,
  decrypt,
  safeDecrypt,
  isLikelyEncrypted,
  isAnyCiphertext,
  setActiveDataKey,
  hasActiveDataKey,
  materializeFolderField,
  sealNoteFieldForWrite,
} from './encrypt';
import { generateDataKey, isV3 } from './cryptoV3';
import { wrapNoteForFolder, isFolderWrapped } from './folderKey';

afterEach(() => setActiveDataKey(null)); // never leak an active key between tests

describe('encrypt/decrypt round-trip', () => {
  it('decrypts what it encrypts', () => {
    const plain = 'Hemlig anteckning 🔐 åäö';
    const cipher = encrypt(plain);
    expect(cipher).not.toEqual(plain);
    expect(decrypt(cipher)).toEqual(plain);
  });

  it('produces a salted ciphertext recognised by isLikelyEncrypted', () => {
    expect(isLikelyEncrypted(encrypt('x'))).toBe(true);
  });

  it('uses a fresh salt per call (ciphertext is non-deterministic)', () => {
    expect(encrypt('same')).not.toEqual(encrypt('same'));
  });
});

describe('isLikelyEncrypted', () => {
  it('is false for plaintext, JSON, and non-strings', () => {
    expect(isLikelyEncrypted('project')).toBe(false);
    expect(isLikelyEncrypted('{"a":1}')).toBe(false);
    expect(isLikelyEncrypted('')).toBe(false);
    expect(isLikelyEncrypted(null)).toBe(false);
    expect(isLikelyEncrypted(42 as unknown)).toBe(false);
  });

  it('is true for our ciphertext', () => {
    expect(isLikelyEncrypted(encrypt('note'))).toBe(true);
  });
});

describe('safeDecrypt — never silently blanks data (the empty-notes bug)', () => {
  it('decrypts valid ciphertext', () => {
    expect(safeDecrypt(encrypt('Köp mjölk'))).toEqual('Köp mjölk');
  });

  it('passes plaintext through untouched instead of collapsing it to ""', () => {
    // This is the exact cause of folders leaking into the notes list: a
    // plaintext/legacy `type: "project"` must survive, not become "" -> "note".
    expect(safeDecrypt('project')).toEqual('project');
    expect(safeDecrypt('My legacy task title')).toEqual('My legacy task title');
  });

  it('falls back to the provided value when ciphertext was encrypted with a different key', () => {
    // Real-world failure: data encrypted under a different key. Decrypting a long
    // payload with the wrong key reliably throws (random bytes are not valid
    // UTF-8), so safeDecrypt must surface the fallback rather than a blank field.
    const wrongKeyCipher = encrypt('x'.repeat(256), 'a-completely-different-key');
    expect(isLikelyEncrypted(wrongKeyCipher)).toBe(true);
    expect(safeDecrypt(wrongKeyCipher, 'FALLBACK')).toEqual('FALLBACK');
    // With no explicit fallback it returns the raw value, still never blank.
    expect(safeDecrypt(wrongKeyCipher)).toEqual(wrongKeyCipher);
  });

  it('returns the fallback (or "") for non-string input', () => {
    expect(safeDecrypt(undefined, 'fb')).toEqual('fb');
    expect(safeDecrypt(null)).toEqual('');
    expect(safeDecrypt(123 as unknown)).toEqual('');
  });

  it('round-trips an empty plaintext without throwing', () => {
    // encrypt('') is valid ciphertext that legitimately decrypts to ''.
    expect(safeDecrypt(encrypt(''))).toEqual('');
  });
});

describe('decrypt — legacy contract preserved', () => {
  it('returns "" on failure (back-compat for existing call sites)', () => {
    expect(decrypt('not-ciphertext')).toEqual('');
    expect(decrypt('')).toEqual('');
  });
});

describe('v3 dispatch — key-aware writer + universal reader', () => {
  it('emits legacy CryptoJS when no data key is active (zero behaviour change)', () => {
    expect(hasActiveDataKey()).toBe(false);
    const c = encrypt('hello');
    expect(isLikelyEncrypted(c)).toBe(true);
    expect(isV3(c)).toBe(false);
  });

  it('emits authenticated v3 once a data key is active, and round-trips it', () => {
    setActiveDataKey(generateDataKey());
    const c = encrypt('hemlig text');
    expect(isV3(c)).toBe(true);
    expect(isAnyCiphertext(c)).toBe(true);
    expect(decrypt(c)).toEqual('hemlig text');
    expect(safeDecrypt(c)).toEqual('hemlig text');
  });

  it('still reads legacy v1 data while a v3 key is active (lazy migration)', () => {
    const legacy = encrypt('gammal anteckning'); // produced with no active key
    setActiveDataKey(generateDataKey()); // now "logged in" with v3
    // The legacy ciphertext predates the key, but must remain readable.
    expect(safeDecrypt(legacy)).toEqual('gammal anteckning');
  });

  it('does not blank a v3 value when the key is absent — returns fallback', () => {
    setActiveDataKey(generateDataKey());
    const c = encrypt('locked content');
    setActiveDataKey(null); // simulate a locked session
    expect(safeDecrypt(c, 'FALLBACK')).toEqual('FALLBACK');
    expect(safeDecrypt(c)).toEqual(c); // never '' — keeps the recoverable envelope
    expect(decrypt(c)).toEqual(''); // legacy contract: '' when unreadable
  });

  it('explicit-key encrypt stays legacy even with an active data key', () => {
    setActiveDataKey(generateDataKey());
    const c = encrypt('per-record', 'a-password');
    expect(isV3(c)).toBe(false);
    expect(decrypt(c, 'a-password')).toEqual('per-record');
  });
});

describe('materializeFolderField (ADR-0012 read-path dispatch)', () => {
  // A raw 256-bit folder key (no KDF needed to exercise the dispatch logic).
  const folderKey = generateDataKey();
  const otherKey = generateDataKey();

  it('decrypts a v3f: field when the folder key is supplied', () => {
    const sealed = wrapNoteForFolder('Hemligt innehåll åäö', folderKey);
    expect(materializeFolderField(sealed, { folderKey })).toBe('Hemligt innehåll åäö');
  });

  it('returns the locked mask for a v3f: field when no key is present', () => {
    const sealed = wrapNoteForFolder('Hemligt', folderKey);
    expect(materializeFolderField(sealed)).toBe(''); // default mask
    expect(materializeFolderField(sealed, { lockedFallback: 'Låst anteckning' })).toBe('Låst anteckning');
    expect(materializeFolderField(sealed, { folderKey: null })).toBe('');
  });

  it('returns the locked mask (never plaintext or ciphertext) for the wrong/rotated key', () => {
    const sealed = wrapNoteForFolder('Hemligt', folderKey);
    const out = materializeFolderField(sealed, { folderKey: otherKey, lockedFallback: 'Låst anteckning' });
    expect(out).toBe('Låst anteckning');
    expect(out).not.toContain('Hemligt');
    expect(out).not.toContain('v3f:');
  });

  it('returns the locked mask for a tampered v3f: ciphertext', () => {
    const sealed = wrapNoteForFolder('Hemligt', folderKey);
    const body = sealed.slice('v3f:'.length);
    const tampered = 'v3f:' + (body[3] === 'A' ? 'B' : 'A') + body.slice(1);
    expect(materializeFolderField(tampered, { folderKey })).toBe('');
  });

  it('falls through to the existing v3 (user dataKey) path — backward compatible', () => {
    setActiveDataKey(generateDataKey());
    const v3 = encrypt('en vanlig låst not under dataKey'); // v3: under the active dataKey
    expect(isV3(v3)).toBe(true);
    expect(materializeFolderField(v3)).toBe('en vanlig låst not under dataKey');
  });

  it('passes plaintext / non-ciphertext through unchanged', () => {
    expect(materializeFolderField('project')).toBe('project');
    expect(materializeFolderField('')).toBe('');
    expect(materializeFolderField(undefined)).toBe('');
  });
});

describe('safeDecrypt / decrypt: defensive v3f: guard (never leak the envelope)', () => {
  it('safeDecrypt returns the mask, not the ciphertext, for a v3f: value', () => {
    const sealed = wrapNoteForFolder('Hemligt', generateDataKey());
    expect(safeDecrypt(sealed)).toBe(''); // no fallback → '' (not the envelope)
    expect(safeDecrypt(sealed, 'Låst anteckning')).toBe('Låst anteckning');
    expect(safeDecrypt(sealed)).not.toContain('v3f:');
  });

  it('decrypt returns "" for a v3f: value (never garbage from the legacy path)', () => {
    const sealed = wrapNoteForFolder('Hemligt', generateDataKey());
    expect(decrypt(sealed)).toBe('');
  });
});

describe('sealNoteFieldForWrite (ADR-0012 write-path seal)', () => {
  const folderKey = generateDataKey();

  it('seals to a v3f: envelope that round-trips through the read path with the same key', () => {
    const sealed = sealNoteFieldForWrite('Hemligt innehåll åäö', folderKey);
    expect(isFolderWrapped(sealed)).toBe(true); // v3f:, not v3:
    expect(materializeFolderField(sealed, { folderKey })).toBe('Hemligt innehåll åäö');
  });

  it('produces ciphertext unreadable without the folder key (locked mask, never the plaintext)', () => {
    const sealed = sealNoteFieldForWrite('Hemligt', folderKey);
    expect(materializeFolderField(sealed, { lockedFallback: 'Låst' })).toBe('Låst'); // no key → masked
    expect(materializeFolderField(sealed, { folderKey: generateDataKey() })).toBe(''); // wrong key → masked
    expect(safeDecrypt(sealed)).toBe(''); // the dataKey reader can't open it either
  });

  it('with no folder key is a true no-op — identical behaviour to encrypt() (backward compatible)', () => {
    setActiveDataKey(generateDataKey());
    const sealed = sealNoteFieldForWrite('en vanlig not', undefined);
    expect(isFolderWrapped(sealed)).toBe(false); // v3:, NOT v3f:
    expect(isV3(sealed)).toBe(true);
    expect(safeDecrypt(sealed)).toBe('en vanlig not'); // reads on the normal dataKey path
  });

  it('treats null / empty-length keys as "no key" (falls back to dataKey encrypt, never an empty seal)', () => {
    setActiveDataKey(generateDataKey());
    expect(isFolderWrapped(sealNoteFieldForWrite('x', null))).toBe(false);
    expect(isFolderWrapped(sealNoteFieldForWrite('x', new Uint8Array(0)))).toBe(false);
    expect(safeDecrypt(sealNoteFieldForWrite('x', null))).toBe('x');
  });

  it('seals XOR dataKey-encrypts — a folder-sealed field is never also a v3: dataKey envelope', () => {
    setActiveDataKey(generateDataKey()); // a dataKey IS active...
    const sealed = sealNoteFieldForWrite('Hemligt', folderKey); // ...but a folder key wins
    expect(isFolderWrapped(sealed)).toBe(true);
    expect(isV3(sealed)).toBe(false); // not double-wrapped under the dataKey
    expect(materializeFolderField(sealed, { folderKey })).toBe('Hemligt');
  });
});
