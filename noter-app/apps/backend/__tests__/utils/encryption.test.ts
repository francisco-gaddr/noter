import { isEncryptedPayload } from '../../src/utils/encryption';

describe('isEncryptedPayload (write-path encryption enforcement)', () => {
  it('accepts legacy v1 CryptoJS ciphertext', () => {
    expect(isEncryptedPayload('U2FsdGVkX1' + 'abcdefghijkl')).toBe(true);
  });

  it('accepts v3 (AES-256-GCM) envelopes — required so v3 E2E writes are not rejected', () => {
    expect(isEncryptedPayload('v3:' + 'aGVsbG8gd29ybGQgdGhpcyBpcyBhIHRlc3Q=')).toBe(true);
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
  });

  it('rejects non-strings', () => {
    expect(isEncryptedPayload(null)).toBe(false);
    expect(isEncryptedPayload(42 as unknown)).toBe(false);
    expect(isEncryptedPayload(undefined)).toBe(false);
  });
});
