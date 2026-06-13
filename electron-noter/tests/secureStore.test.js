'use strict';

const { createSecureStore, _internal } = require('../src/secureStore');

// In-memory fs + a fake safeStorage that "encrypts" by prefixing a tag, so we can
// assert the on-disk blob is never plaintext and that round-trips work.
function makeHarness({ available = true } = {}) {
  const files = new Map();
  const fs = {
    existsSync: (p) => files.has(p),
    readFileSync: (p) => {
      if (!files.has(p)) throw new Error('ENOENT');
      return files.get(p);
    },
    writeFileSync: (p, data) => files.set(p, data),
  };
  const path = { join: (...parts) => parts.join('/') };
  const app = { getPath: () => '/userData' };
  const safeStorage = {
    isEncryptionAvailable: () => available,
    encryptString: (s) => Buffer.from('ENC::' + s, 'utf8'),
    decryptString: (buf) => {
      const s = Buffer.from(buf).toString('utf8');
      if (!s.startsWith('ENC::')) throw new Error('bad ciphertext');
      return s.slice(5);
    },
  };
  const store = createSecureStore({ app, safeStorage, fs, path });
  return { store, files, filePath: '/userData/' + _internal.SECURE_FILE };
}

describe('secureStore', () => {
  it('round-trips a secret and never stores it in plaintext', () => {
    const { store, files, filePath } = makeHarness();
    expect(store.set('token', 'jwt-abc-123')).toBe(true);
    expect(store.get('token')).toBe('jwt-abc-123');

    const onDisk = files.get(filePath);
    expect(onDisk).not.toContain('jwt-abc-123'); // value is encrypted at rest
  });

  it('returns null for missing keys', () => {
    const { store } = makeHarness();
    expect(store.get('nope')).toBeNull();
  });

  it('refuses to write (no plaintext leak) when OS encryption is unavailable', () => {
    const { store, files, filePath } = makeHarness({ available: false });
    expect(store.set('token', 'secret')).toBe(false);
    expect(store.get('token')).toBeNull();
    expect(files.has(filePath)).toBe(false);
  });

  it('deletes a key (including via set(key, null))', () => {
    const { store } = makeHarness();
    store.set('a', '1');
    store.set('b', '2');
    expect(store.set('a', null)).toBe(true);
    expect(store.get('a')).toBeNull();
    expect(store.get('b')).toBe('2');
    expect(store.delete('b')).toBe(true);
    expect(store.listKeys()).toEqual([]);
  });

  it('clear() removes every secret', () => {
    const { store } = makeHarness();
    store.set('a', '1');
    store.set('b', '2');
    store.clear();
    expect(store.listKeys()).toEqual([]);
  });

  it('survives a corrupt store file', () => {
    const { store, files, filePath } = makeHarness();
    files.set(filePath, '{ not valid json');
    expect(store.get('x')).toBeNull();
    expect(store.listKeys()).toEqual([]);
  });
});
