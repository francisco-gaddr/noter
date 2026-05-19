import { randomBytes } from 'node:crypto';

// Set the master key BEFORE importing the module — it reads env at first use.
process.env.FIELD_ENCRYPTION_KEY = randomBytes(32).toString('base64url');

import {
  encryptField,
  decryptField,
  tryDecryptField,
  isFieldEncryptionConfigured,
  _resetMasterCache,
} from '../../src/utils/fieldEncryption';

describe('fieldEncryption', () => {
  beforeEach(() => _resetMasterCache());

  it('isFieldEncryptionConfigured reports true when env is set', () => {
    expect(isFieldEncryptionConfigured()).toBe(true);
  });

  it('round-trips plaintext through encrypt/decrypt', () => {
    const enc = encryptField('hello world', 'audit-log');
    expect(typeof enc).toBe('string');
    expect(enc.length).toBeGreaterThan(40);
    expect(decryptField(enc, 'audit-log')).toBe('hello world');
  });

  it('produces different ciphertexts for the same plaintext (random IV)', () => {
    const a = encryptField('secret', 'scope');
    const b = encryptField('secret', 'scope');
    expect(a).not.toBe(b);
    expect(decryptField(a, 'scope')).toBe('secret');
    expect(decryptField(b, 'scope')).toBe('secret');
  });

  it('rejects decryption with wrong scope (key separation)', () => {
    const enc = encryptField('confidential', 'scope-A');
    expect(() => decryptField(enc, 'scope-B')).toThrow();
  });

  it('rejects malformed envelope', () => {
    expect(() => decryptField('not-an-envelope!', 'scope')).toThrow();
    expect(() => decryptField('', 'scope')).toThrow();
  });

  it('rejects invalid scope', () => {
    expect(() => encryptField('hi', 'scope with spaces')).toThrow(/scope/);
    expect(() => encryptField('hi', 'a'.repeat(200))).toThrow(/scope/);
  });

  it('tryDecryptField returns null on failure', () => {
    expect(tryDecryptField('garbage', 'scope')).toBeNull();
    expect(tryDecryptField(null, 'scope')).toBeNull();
  });

  it('tryDecryptField returns the plaintext on success', () => {
    const enc = encryptField('ok', 'scope');
    expect(tryDecryptField(enc, 'scope')).toBe('ok');
  });

  it('refuses encrypt without master key configured', () => {
    delete process.env.FIELD_ENCRYPTION_KEY;
    _resetMasterCache();
    expect(() => encryptField('x', 'scope')).toThrow(/not configured/);
    // restore for other tests
    process.env.FIELD_ENCRYPTION_KEY = randomBytes(32).toString('base64url');
    _resetMasterCache();
  });

  it('detects tampering — flipped bit fails auth-tag', () => {
    const enc = encryptField('secret', 'scope');
    const buf = Buffer.from(enc, 'base64url');
    buf[buf.length - 1] ^= 0xff; // tamper the last byte
    const tampered = buf.toString('base64url');
    expect(() => decryptField(tampered, 'scope')).toThrow();
  });
});
