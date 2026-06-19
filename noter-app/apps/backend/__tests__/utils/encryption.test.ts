import { isEncryptedPayload } from '../../src/utils/encryption';

describe('isEncryptedPayload (write-path encryption enforcement)', () => {
  it('accepts legacy v1 CryptoJS ciphertext', () => {
    expect(isEncryptedPayload('U2FsdGVkX1' + 'abcdefghijkl')).toBe(true);
  });

  it('accepts v3 (AES-256-GCM) envelopes — required so v3 E2E writes are not rejected', () => {
    expect(isEncryptedPayload('v3:' + 'aGVsbG8gd29ybGQgdGhpcyBpcyBhIHRlc3Q=')).toBe(true);
  });

  it('accepts v3f (per-folder-key sealed) envelopes — required so notes locked into a crypto folder are not rejected (ADR-0012)', () => {
    // A v3f: payload does NOT start with 'v3:' ('v3f' !== 'v3:'); without its own
    // branch the server would 400 every write into a per-folder-encrypted folder.
    expect(isEncryptedPayload('v3f:' + 'aGVsbG8gd29ybGQgdGhpcyBpcyBhIHRlc3Q=')).toBe(true);
  });

  it('rejects plaintext', () => {
    expect(isEncryptedPayload('Min hemliga anteckning')).toBe(false);
    expect(isEncryptedPayload('project')).toBe(false);
    expect(isEncryptedPayload('')).toBe(false);
  });

  it('rejects values containing whitespace (not a single ciphertext token)', () => {
    expect(isEncryptedPayload('U2FsdGVkX1 abcdefgh')).toBe(false);
    expect(isEncryptedPayload('v3:ab cd')).toBe(false);
  });

  it('rejects too-short prefixed values', () => {
    expect(isEncryptedPayload('U2FsdGVkX1')).toBe(false);
    expect(isEncryptedPayload('v3:short')).toBe(false);
    expect(isEncryptedPayload('v3f:short')).toBe(false);
  });

  it('rejects v3f values containing whitespace (not a single ciphertext token)', () => {
    expect(isEncryptedPayload('v3f:ab cd')).toBe(false);
  });

  it('rejects non-strings', () => {
    expect(isEncryptedPayload(null)).toBe(false);
    expect(isEncryptedPayload(42 as unknown)).toBe(false);
    expect(isEncryptedPayload(undefined)).toBe(false);
  });
});
