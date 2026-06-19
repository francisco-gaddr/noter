// Legacy CryptoJS "salted" ciphertext (v1) base64-encodes the "Salted__" magic
// to this prefix. The v3 envelope (AES-256-GCM, see packages/shared/cryptoV3) is
// tagged `v3:`; a per-folder-key-sealed field (ADR-0012, see packages/shared/folderKey)
// is the same GCM envelope under a folder key with the distinguishing tag `v3f:`.
// The backend enforces that user content is ciphertext on write, so it MUST accept
// ALL THREE — otherwise enabling v3 E2E (or locking a project folder with a per-folder
// password) would make the server reject every affected note/task write with a 400.
// NB: `v3f:` does NOT start with `v3:` ('v3f' !== 'v3:'), so it needs its own branch —
// without it, a note sealed into a crypto folder is rejected at the write boundary.
const ENCRYPTED_PREFIX = 'U2FsdGVkX1';
const V3_PREFIX = 'v3:';
const V3_FOLDER_PREFIX = 'v3f:';

export const isEncryptedPayload = (value: unknown): boolean => {
  if (typeof value !== 'string') return false;
  if (/\s/.test(value)) return false;

  // v3 / v3f: prefix + base64(iv(12) | ciphertext | tag(16)) — at minimum iv+tag = 28
  // bytes ≈ 38 base64 chars, so anything past the prefix + a small floor is fine.
  if (value.startsWith(V3_FOLDER_PREFIX)) {
    return value.length > V3_FOLDER_PREFIX.length + 16;
  }
  if (value.startsWith(V3_PREFIX)) {
    return value.length > V3_PREFIX.length + 16;
  }

  // Legacy v1 (CryptoJS salted).
  if (!value.startsWith(ENCRYPTED_PREFIX)) return false;
  return value.length >= ENCRYPTED_PREFIX.length + 8;
};
