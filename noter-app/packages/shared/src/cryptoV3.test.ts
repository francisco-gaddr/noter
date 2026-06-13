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
    // flip a character in the base64 body
    const body = env.slice(3);
    const tampered = 'v3:' + (body[5] === 'A' ? 'B' : 'A') + body.slice(1);
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
    const { key: rootKey, kdf } = await deriveRootKey(password, salt, 'pbkdf2-sha256');
    const dataKey = generateDataKey();
    const wrapped = wrapDataKey(dataKey, rootKey); // this is what the server keeps
    const note = encryptV3('Top secret note', dataKey);

    // new session / device: only password + (salt, kdf, wrapped) available
    const rootKey2 = await deriveRootKeyWithKdf(password, salt, kdf);
    const dataKey2 = unwrapDataKey(wrapped, rootKey2);
    expect(decryptV3(note, dataKey2)).toEqual('Top secret note');
  });
});
