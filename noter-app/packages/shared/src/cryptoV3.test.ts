import {
  encryptV3,
  decryptV3,
  isV3,
  generateDataKey,
  generateSalt,
  deriveRootKey,
  deriveRootKeyWithKdf,
  wrapDataKey,
  unwrapDataKey,
  isWrappedKey,
  bytesToB64,
  b64ToBytes,
  generateRecoveryCode,
  normalizeRecoveryCode,
} from './cryptoV3';

describe('base64 codec (runtime-independent)', () => {
  it('round-trips arbitrary byte lengths', () => {
    for (let len = 0; len < 40; len++) {
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = (i * 37 + 11) & 0xff;
      expect(Array.from(b64ToBytes(bytesToB64(bytes)))).toEqual(Array.from(bytes));
    }
  });
});

describe('encryptV3 / decryptV3 (AES-256-GCM)', () => {
  const key = generateDataKey();

  it('round-trips unicode content', () => {
    const plain = 'Köp mjölk 🥛 — och ÅÄÖ';
    const env = encryptV3(plain, key);
    expect(isV3(env)).toBe(true);
    expect(decryptV3(env, key)).toEqual(plain);
  });

  it('uses a fresh IV per call (non-deterministic ciphertext)', () => {
    expect(encryptV3('same', key)).not.toEqual(encryptV3('same', key));
  });

  it('round-trips empty string', () => {
    expect(decryptV3(encryptV3('', key), key)).toEqual('');
  });

  it('rejects a wrong key (authenticated)', () => {
    const env = encryptV3('secret', key);
    expect(() => decryptV3(env, generateDataKey())).toThrow();
  });

  it('rejects tampered ciphertext (auth tag)', () => {
    const env = encryptV3('secret', key);
    // Flip a real byte in the decoded payload (deterministic — a single base64-char swap can
    // land on discarded alignment bits and decode to the same bytes, which used to flake here).
    const body = env.slice(3);
    const buf = Buffer.from(body, 'base64');
    const i = Math.floor(buf.length / 2);
    buf[i] = buf[i] ^ 0xff;
    const tampered = 'v3:' + buf.toString('base64');
    expect(tampered).not.toBe(env);
    expect(() => decryptV3(tampered, key)).toThrow();
  });
});

describe('recovery code', () => {
  it('generates a grouped, unambiguous code and normalises it back', () => {
    const code = generateRecoveryCode();
    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4})+$/);
    expect(normalizeRecoveryCode(code)).toBe(code.replace(/-/g, ''));
    expect(normalizeRecoveryCode(code.toLowerCase().replace(/-/g, ' '))).toBe(code.replace(/-/g, ''));
  });

  it('is non-deterministic', () => {
    expect(generateRecoveryCode()).not.toBe(generateRecoveryCode());
  });
});

describe('key derivation', () => {
  it('derives a 32-byte root key and reports the KDF used', async () => {
    const salt = generateSalt();
    const { key, kdf } = await deriveRootKey('correct horse battery staple', salt);
    expect(key.length).toBe(32);
    expect(['argon2id', 'pbkdf2-sha256']).toContain(kdf);
  });

  it('is deterministic for the same password+salt+kdf', async () => {
    const salt = generateSalt();
    const a = await deriveRootKeyWithKdf('pw', salt, 'pbkdf2-sha256');
    const b = await deriveRootKeyWithKdf('pw', salt, 'pbkdf2-sha256');
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('differs for a different salt', async () => {
    const a = await deriveRootKeyWithKdf('pw', generateSalt(), 'pbkdf2-sha256');
    const b = await deriveRootKeyWithKdf('pw', generateSalt(), 'pbkdf2-sha256');
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });
});

describe('dataKey wrap / unwrap', () => {
  it('wraps and unwraps a dataKey under a password-derived root key', async () => {
    const salt = generateSalt();
    const { key: rootKey } = await deriveRootKey('hunter2', salt, 'pbkdf2-sha256');
    const dataKey = generateDataKey();

    const wrapped = wrapDataKey(dataKey, rootKey);
    expect(isWrappedKey(wrapped)).toBe(true);

    const unwrapped = unwrapDataKey(wrapped, rootKey);
    expect(Array.from(unwrapped)).toEqual(Array.from(dataKey));
  });

  it('fails to unwrap with the wrong password', async () => {
    const salt = generateSalt();
    const dataKey = generateDataKey();
    const { key: rootKey } = await deriveRootKey('right', salt, 'pbkdf2-sha256');
    const wrapped = wrapDataKey(dataKey, rootKey);

    const wrongRoot = await deriveRootKeyWithKdf('wrong', salt, 'pbkdf2-sha256');
    expect(() => unwrapDataKey(wrapped, wrongRoot)).toThrow();
  });

  it('end-to-end: derive → wrap → (server stores wrapped) → re-derive → unwrap → decrypt', async () => {
    const password = 'a-very-good-password';
    const salt = generateSalt();

    // enrolment
    const { key: rootKey, kdf, params } = await deriveRootKey(password, salt, 'pbkdf2-sha256');
    const dataKey = generateDataKey();
    const wrapped = wrapDataKey(dataKey, rootKey); // this is what the server keeps
    const note = encryptV3('Top secret note', dataKey);

    // new session / device: password + (salt, kdf, params, wrapped) available. Params are stored WITH
    // the wrap so unwrap reproduces the exact key even after the new-wrap KDF defaults change.
    const rootKey2 = await deriveRootKeyWithKdf(password, salt, kdf, params);
    const dataKey2 = unwrapDataKey(wrapped, rootKey2);
    expect(decryptV3(note, dataKey2)).toEqual('Top secret note');
  });

  it('BACKWARD COMPAT: a legacy pbkdf2 wrap with NO stored params unwraps via the 200k baseline', async () => {
    const { deriveRootKeyWithKdf: dk } = await import('./cryptoV3');
    const password = 'legacy-pw';
    const salt = generateSalt();
    // Simulate a pre-params wrap: derive at the OLD 200k count directly (what old code produced).
    const { pbkdf2Async } = await import('@noble/hashes/pbkdf2');
    const { sha256 } = await import('@noble/hashes/sha2');
    const { utf8ToBytes } = await import('@noble/hashes/utils');
    const legacyRoot = await pbkdf2Async(sha256, utf8ToBytes(password), salt, { c: 200_000, dkLen: 32 });
    const dataKey = generateDataKey();
    const wrapped = wrapDataKey(dataKey, legacyRoot);
    // Unwrap with NO params → must fall back to 200k and reproduce the same key.
    const root2 = await dk(password, salt, 'pbkdf2-sha256');
    expect(Array.from(unwrapDataKey(wrapped, root2))).toEqual(Array.from(dataKey));
  });

  it('rejects a tampered/garbage KDF params object (falls back to safe defaults)', async () => {
    const { parseKdfParams } = await import('./cryptoV3');
    expect(parseKdfParams('argon2id', { m: -1, t: 2, p: 1 })).toBeNull();
    expect(parseKdfParams('argon2id', { m: 19456, t: 2, p: 1 })).toEqual({ m: 19456, t: 2, p: 1 });
    expect(parseKdfParams('pbkdf2-sha256', { c: 0 })).toBeNull();
    expect(parseKdfParams('pbkdf2-sha256', { c: 600000 })).toEqual({ c: 600000 });
    expect(parseKdfParams('pbkdf2-sha256', 'nope')).toBeNull();
  });
});
