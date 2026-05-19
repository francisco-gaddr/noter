import { hashPassword, verifyPassword, needsRehash, getActiveAlgorithm, _isArgon2Hash, _isBcryptHash } from '../../src/utils/passwordHasher';

describe('passwordHasher', () => {
  it('rejects too-short passwords', async () => {
    await expect(hashPassword('short')).rejects.toThrow(/too short/);
  });

  it('rejects pathologically-long passwords', async () => {
    await expect(hashPassword('x'.repeat(2000))).rejects.toThrow(/too long/);
  });

  it('produces a recognisable hash format', async () => {
    const hash = await hashPassword('a-decent-password-123');
    expect(typeof hash).toBe('string');
    expect(hash.length).toBeGreaterThan(20);
    // Argon2id starts with $argon2id$; bcrypt starts with $2[aby]$
    expect(_isArgon2Hash(hash) || _isBcryptHash(hash)).toBe(true);
  }, 15_000);

  it('verifies a hash it just produced', async () => {
    const pw = 'my-secure-secret-42';
    const hash = await hashPassword(pw);
    expect(await verifyPassword(pw, hash)).toBe(true);
    expect(await verifyPassword('wrong-password', hash)).toBe(false);
  }, 15_000);

  it('verifies legacy bcrypt hashes', async () => {
    // Pre-generated bcrypt hash for 'legacy-password'
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const bcrypt = require('bcryptjs');
    const legacyHash = await bcrypt.hash('legacy-password', 10);
    expect(_isBcryptHash(legacyHash)).toBe(true);
    expect(await verifyPassword('legacy-password', legacyHash)).toBe(true);
    expect(await verifyPassword('wrong', legacyHash)).toBe(false);
  });

  it('verifyPassword returns false for malformed hash without throwing', async () => {
    expect(await verifyPassword('anything', 'not-a-hash')).toBe(false);
    expect(await verifyPassword('anything', '')).toBe(false);
  });

  it('needsRehash flags bcrypt hashes for upgrade when argon2 is available', async () => {
    if (getActiveAlgorithm() !== 'argon2id') {
      // Skip — argon2 isn't loaded in this environment
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const bcrypt = require('bcryptjs');
    const legacy = await bcrypt.hash('legacy', 10);
    expect(needsRehash(legacy)).toBe(true);
  });

  it('needsRehash returns false for a fresh argon2 hash at current params', async () => {
    if (getActiveAlgorithm() !== 'argon2id') return;
    const fresh = await hashPassword('a-decent-password-456');
    if (!_isArgon2Hash(fresh)) return; // env doesn't have argon2 — skip
    expect(needsRehash(fresh)).toBe(false);
  }, 15_000);

  it('needsRehash returns true for unrecognised hash format', () => {
    expect(needsRehash('random-string')).toBe(true);
  });
});
