'use strict';

/**
 * OS-keychain–backed secret store for the desktop app.
 *
 * Uses Electron `safeStorage`, which encrypts with the platform secret service:
 *   - macOS:   Keychain
 *   - Windows: DPAPI (per-user)
 *   - Linux:   libsecret / kwallet (falls back to "basic" — see isAvailable)
 *
 * Secrets are persisted as a single JSON map of `{ key: base64(ciphertext) }` in
 * `secure-store.bin` under userData, with `0600` permissions. This is where the
 * renderer should keep the auth token and the v3 `dataKey` instead of plaintext
 * localStorage.
 *
 * Pure logic with injected `app`/`safeStorage`/`fs`/`path` so it is unit-testable
 * without a running Electron app (see tests/secureStore.test.js).
 */

const SECURE_FILE = 'secure-store.bin';

const storePath = (app, path) => path.join(app.getPath('userData'), SECURE_FILE);

const readBlob = (fs, filePath) => {
  try {
    if (!fs.existsSync(filePath)) return {};
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
};

const writeBlob = (fs, filePath, data) => {
  fs.writeFileSync(filePath, JSON.stringify(data), { mode: 0o600 });
};

function createSecureStore({ app, safeStorage, fs, path }) {
  const filePath = () => storePath(app, path);

  const isAvailable = () => {
    try {
      return safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  };

  return {
    isAvailable,

    /** Decrypt and return a secret, or null if missing / unavailable / corrupt. */
    get(key) {
      if (!isAvailable() || typeof key !== 'string' || !key) return null;
      const enc = readBlob(fs, filePath())[key];
      if (typeof enc !== 'string') return null;
      try {
        return safeStorage.decryptString(Buffer.from(enc, 'base64'));
      } catch {
        return null;
      }
    },

    /**
     * Encrypt and persist a secret. A null/undefined value deletes the key.
     * Returns false (and stores nothing) when OS encryption is unavailable, so
     * the caller can fall back to in-memory handling rather than leaking plaintext.
     */
    set(key, value) {
      if (typeof key !== 'string' || !key) return false;
      if (value === null || value === undefined) return this.delete(key);
      if (!isAvailable()) return false;
      const blob = readBlob(fs, filePath());
      blob[key] = Buffer.from(safeStorage.encryptString(String(value))).toString('base64');
      writeBlob(fs, filePath(), blob);
      return true;
    },

    delete(key) {
      if (typeof key !== 'string' || !key) return false;
      const blob = readBlob(fs, filePath());
      if (!(key in blob)) return true;
      delete blob[key];
      writeBlob(fs, filePath(), blob);
      return true;
    },

    listKeys() {
      return Object.keys(readBlob(fs, filePath()));
    },

    /** Remove every secret (e.g. on logout / "forget this device"). */
    clear() {
      writeBlob(fs, filePath(), {});
      return true;
    },
  };
}

module.exports = {
  createSecureStore,
  _internal: { SECURE_FILE, storePath, readBlob, writeBlob },
};
