import {
  encrypt,
  decrypt,
  safeDecrypt,
  isLikelyEncrypted,
  isAnyCiphertext,
  setActiveDataKey,
  hasActiveDataKey,
} from './encrypt';
import { generateDataKey, isV3 } from './cryptoV3';

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
