import CryptoJS from 'crypto-js';
import { encryptV3, decryptV3, isV3 } from './cryptoV3';

const DEFAULT_KEY = 'noter-default-key';

// CryptoJS writes OpenSSL "salted" ciphertext: base64 of ("Salted__" + 8-byte
// salt + AES-CBC data). The ASCII magic "Salted__" always base64-encodes to the
// prefix below, so its presence is a reliable marker that a string is a legacy
// (v1) ciphertext rather than plaintext / a v3 envelope.
const SALT_PREFIX = 'U2FsdGVkX1';

// ---------------------------------------------------------------------------
// Active data key (the per-user key, set after unlock).
//
// While null, the module behaves exactly as before: writes use the legacy
// CryptoJS scheme and v3 reads are impossible. Once the app has derived and
// verified the user's dataKey it calls setActiveDataKey(); from then on *writes*
// emit authenticated AES-256-GCM (v3) and reads transparently handle v3, legacy
// (v1) and plaintext. Legacy reading is never removed, so existing data on the
// server / device stays readable throughout the migration.
// ---------------------------------------------------------------------------
let activeDataKey: Uint8Array | null = null;

/** Install the per-user data key (after unlock). Pass null to clear (on lock). */
export const setActiveDataKey = (key: Uint8Array | null): void => {
  activeDataKey = key;
};
export const hasActiveDataKey = (): boolean => activeDataKey !== null;

/**
 * Encrypt a string.
 * - With an explicit `key` arg: always the legacy CryptoJS scheme (back-compat
 *   for the few call sites that pass a per-record password).
 * - Otherwise: AES-256-GCM (v3) when a data key is active, else legacy CryptoJS.
 */
export const encrypt = (text: string, key?: string): string => {
  if (key === undefined && activeDataKey) {
    return encryptV3(text, activeDataKey);
  }
  return CryptoJS.AES.encrypt(text, key ?? DEFAULT_KEY).toString();
};

/**
 * True when `value` carries the CryptoJS legacy salted-ciphertext marker. Used to
 * avoid running plaintext (or already-decrypted) values back through decrypt(),
 * which would otherwise yield '' and silently blank out the field.
 */
export const isLikelyEncrypted = (value: unknown): value is string =>
  typeof value === 'string' && value.startsWith(SALT_PREFIX);

/** Any value we recognise as one of our ciphertexts (v3 or legacy v1). */
export const isAnyCiphertext = (value: unknown): value is string =>
  isV3(value) || isLikelyEncrypted(value);

/**
 * Strict legacy decrypt: throws ("Malformed UTF-8 data") on a wrong key or
 * corrupt ciphertext instead of masking it as ''. Internal.
 */
const decryptStrictLegacy = (ciphertext: string, key: string = DEFAULT_KEY): string => {
  const bytes = CryptoJS.AES.decrypt(ciphertext, key);
  return bytes.toString(CryptoJS.enc.Utf8);
};

/**
 * Backward-compatible decrypt. Returns '' on any failure (the historical
 * contract many call sites still rely on). Handles v3 envelopes when a data key
 * is active. Prefer safeDecrypt() for any user-facing field.
 */
export const decrypt = (ciphertext: string, key?: string): string => {
  if (!ciphertext) return '';
  if (key === undefined && isV3(ciphertext)) {
    if (!activeDataKey) return '';
    try {
      return decryptV3(ciphertext, activeDataKey);
    } catch {
      return '';
    }
  }
  try {
    return decryptStrictLegacy(ciphertext, key ?? DEFAULT_KEY);
  } catch {
    return '';
  }
};

/**
 * Decrypt that never silently destroys data. Behaviour:
 *  - non-string             -> `fallback` if given, else ''
 *  - v3 envelope            -> AES-256-GCM decrypt with the active data key;
 *                              on failure (no key / wrong key / tampered) returns
 *                              `fallback` if given, else the original value.
 *  - not a ciphertext       -> returned unchanged (already plaintext / legacy /
 *                              double-processed) — this is what stops plaintext
 *                              `type: "project"` from collapsing to '' (and a
 *                              folder leaking into the notes list).
 *  - legacy ciphertext      -> decrypted plaintext (which may legitimately be '')
 *  - wrong key / corrupt    -> `fallback` if given, else the original value;
 *                              never '' so the user keeps something recoverable.
 */
export const safeDecrypt = (value: unknown, fallback?: string): string => {
  if (typeof value !== 'string') return typeof fallback === 'string' ? fallback : '';
  if (isV3(value)) {
    if (activeDataKey) {
      try {
        return decryptV3(value, activeDataKey);
      } catch {
        return typeof fallback === 'string' ? fallback : value;
      }
    }
    return typeof fallback === 'string' ? fallback : value;
  }
  if (!isLikelyEncrypted(value)) return value;
  try {
    return decryptStrictLegacy(value, DEFAULT_KEY);
  } catch {
    return typeof fallback === 'string' ? fallback : value;
  }
};

export * from './cryptoV3';
