// Legacy CryptoJS "salted" ciphertext (v1) base64-encodes the "Salted__" magic
// to this prefix. The v3 envelope (AES-256-GCM, see packages/shared/cryptoV3) is
// tagged `v3:`. The backend enforces that user content is ciphertext on write, so
// it MUST accept BOTH — otherwise enabling v3 E2E would make the server reject
// every note/task write with a 400.
const ENCRYPTED_PREFIX = 'U2FsdGVkX1';
const V3_PREFIX = 'v3:';

export const isEncryptedPayload = (value: unknown): boolean => {
  if (typeof value !== 'string') return false;
  if (/\s/.test(value)) return false;

  // v3: 'v3:' + base64(iv(12) | ciphertext | tag(16)) — at minimum iv+tag = 28
  // bytes ≈ 38 base64 chars, so anything past the prefix + a small floor is fine.
  if (value.startsWith(V3_PREFIX)) {
    return value.length > V3_PREFIX.length + 16;
  }

  // Legacy v1 (CryptoJS salted).
  if (!value.startsWith(ENCRYPTED_PREFIX)) return false;
  return value.length >= ENCRYPTED_PREFIX.length + 8;
};
