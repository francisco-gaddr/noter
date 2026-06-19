import CryptoJS from 'crypto-js';
import { encryptV3, decryptV3, isV3 } from './cryptoV3';
import { isFolderWrapped, unwrapNoteForFolder, wrapNoteForFolder } from './folderKey';

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
  // A folder-wrapped (`v3f:`) field can only be opened with that folder's key, which this
  // path does not have — never fall through to the legacy decoder (it would return garbage)
  // and never echo the ciphertext. Stays blank/locked until materializeFolderField is used.
  if (isFolderWrapped(ciphertext)) return '';
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
  // Defense-in-depth for the per-folder crypto boundary (ADR-0012): a folder-wrapped (`v3f:`)
  // field is unreadable without its folder key, which safeDecrypt does not hold. Return the
  // mask/fallback (never the ciphertext) so a call site that forgot to route through
  // materializeFolderField degrades to "locked/blank" rather than leaking the envelope.
  if (isFolderWrapped(value)) return typeof fallback === 'string' ? fallback : '';
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

/** Options for {@link materializeFolderField}. */
export interface FolderFieldOptions {
  /**
   * The unlocked folder key for this note's folder, if the user has entered the folder password
   * this session. Absent/empty → the field is treated as locked and the mask is returned.
   */
  folderKey?: Uint8Array | null;
  /**
   * What to return when the field is `v3f:` but cannot be opened (no key, wrong/rotated key, or
   * tampered ciphertext). Lets the caller pick the per-field mask, e.g. 'Låst anteckning' for a
   * title and '' for the body. Defaults to ''.
   */
  lockedFallback?: string;
}

/**
 * Read-path dispatch for a (possibly per-folder-encrypted) note field — the ADR-0012 Fas 2
 * reader. This is what the materialize layer should call for a field that MIGHT be folder-wrapped;
 * it never exposes ciphertext and never throws:
 *
 *  - `v3f:` + a folder key present  → decrypt with the folder key (on any failure → `lockedFallback`).
 *  - `v3f:` + no folder key          → `lockedFallback` (the field stays cryptographically locked).
 *  - anything else                   → existing {@link safeDecrypt} path (v3 under the user dataKey,
 *                                      legacy v1, or plaintext) — so existing locked notes that are
 *                                      still `v3:` under the dataKey keep reading exactly as before
 *                                      (backward compatible).
 */
export const materializeFolderField = (value: unknown, opts: FolderFieldOptions = {}): string => {
  const lockedFallback = typeof opts.lockedFallback === 'string' ? opts.lockedFallback : '';
  if (isFolderWrapped(value)) {
    const key = opts.folderKey;
    if (key && key.length > 0) {
      try {
        return unwrapNoteForFolder(value as string, key);
      } catch {
        return lockedFallback; // wrong/rotated key or tampered → stay locked, never expose
      }
    }
    return lockedFallback; // no key → locked
  }
  return safeDecrypt(value);
};

/**
 * Write-path counterpart of {@link materializeFolderField} — the ADR-0012 Fas 2 *writer*. Centralises
 * the single decision the save path must make for a note's sensitive field (`title`/`content`):
 *
 *  - a folder key present → seal the plaintext into a `v3f:` envelope under that folder key
 *                           ({@link wrapNoteForFolder}). The field is then readable ONLY by someone
 *                           who has entered the folder password — not even with the user's dataKey.
 *  - no folder key        → the existing {@link encrypt} path (v3 under the user dataKey when one is
 *                           active, else legacy) — so notes outside a crypto-protected folder are
 *                           written exactly as before (backward compatible; a true no-op).
 *
 * A field is therefore sealed XOR dataKey-encrypted — never double-wrapped. The seal decision (which
 * folder key, if any) belongs to the caller: the store resolves it from the note's nearest locked
 * ancestor via getFolderKey() and threads it through api.ts as the optional `folderKey`. Keeping the
 * branch here (not duplicated in each app's api.ts) keeps all crypto in @repo/shared and both clients
 * in lock-step — exactly mirroring how the read path funnels through materializeFolderField.
 */
export const sealNoteFieldForWrite = (plaintext: string, folderKey?: Uint8Array | null): string => {
  if (folderKey && folderKey.length > 0) {
    return wrapNoteForFolder(plaintext, folderKey);
  }
  return encrypt(plaintext);
};

export * from './cryptoV3';
