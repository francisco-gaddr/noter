/**
 * folderKey — per-folder cryptographic boundary for locked project folders (implements
 * ADR-0012, the §8.1 hardening of docs/LOCKED_FOLDER_SECURITY.md).
 *
 * Today a locked folder is protected by *filtering* (`isReadableWithLocks` masks it everywhere)
 * while its content is encrypted under the user's single `dataKey` — so a bug in the filter, or a
 * surface that forgets to apply it, could expose plaintext. This module makes the lock a
 * *cryptographic* boundary instead: the folder's notes are encrypted under a **folder key** that
 * only exists in memory after the user enters the folder password. Without the password the
 * ciphertext is unreadable, not merely hidden.
 *
 * Design (mirrors the dataKey/rootKey/recovery architecture in `cryptoV3`):
 *   - Each protected folder owns a random 256-bit **folder key** (FK).
 *   - FK is wrapped (AES-256-GCM) under a **folder root key** derived from the folder password via
 *     Argon2id (PBKDF2 fallback) with a per-folder salt. Only the *wrapped* FK + salt + kdf are
 *     persisted (the `FolderKeyBundle`); the password and FK are never stored.
 *   - A note's `title`/`content` inside the folder is sealed with `wrapNoteForFolder` into a
 *     `v3f:`-prefixed envelope — a normal `v3:` GCM envelope under FK with a distinguishing prefix,
 *     so the read path can tell "needs the folder key" from "needs the user dataKey" (existing
 *     `v3:` locked notes stay readable — backward compatible; see the migration note in §8.1).
 *
 * Changing the folder password re-wraps the SAME FK (`rewrapFolderKey`) — no note is re-encrypted,
 * exactly like the user password change re-wraps the dataKey.
 *
 * IMPORTANT: this is the pure crypto primitive only. It is intentionally NOT yet wired into the
 * stores / materialize path — that is a separate, carefully-staged change (see ADR-0012 §Migration).
 */
import {
  generateDataKey,
  generateSalt,
  deriveRootKey,
  deriveRootKeyWithKdf,
  wrapDataKey,
  unwrapDataKey,
  encryptV3,
  decryptV3,
  bytesToB64,
  b64ToBytes,
  V3_PREFIX,
  parseKdfParams,
  type KdfId,
  type KdfParams,
} from './cryptoV3';

/** Envelope prefix for note content sealed under a folder key (vs. `v3:` under the user dataKey). */
export const FOLDER_CONTENT_PREFIX = 'v3f:';

/** Current bundle schema version, so the format can evolve without ambiguity. */
export const FOLDER_KEY_BUNDLE_VERSION = 1 as const;

/**
 * The per-folder enrolment material that is persisted (on the folder note). It contains NO secret
 * that is usable without the folder password: the folder key is stored only in `wrappedKey`, sealed
 * under the password-derived root key.
 */
export interface FolderKeyBundle {
  v: typeof FOLDER_KEY_BUNDLE_VERSION;
  /** Base64 per-folder KDF salt. */
  salt: string;
  /** Which KDF produced the root key (so unlock uses the same one). */
  kdf: KdfId;
  /** KDF cost params recorded with the wrap so unlock reproduces the exact key even after the
   *  NEW-wrap defaults are raised. Absent on folders created before this field → legacy baselines. */
  kdfParams?: KdfParams;
  /** The folder key wrapped under the password-derived root key (`v3w:` envelope). */
  wrappedKey: string;
}

/** Thrown when a folder password is wrong or the bundle/ciphertext is corrupt/tampered. */
export class FolderUnlockError extends Error {
  constructor(message = 'Wrong folder password or corrupt folder key bundle') {
    super(message);
    this.name = 'FolderUnlockError';
    // Restore the prototype chain so `instanceof FolderUnlockError` holds even when this is transpiled
    // down to ES5 (the web/babel target), where `extends Error` otherwise loses it. Without this, the
    // UI's `catch (e) { if (e instanceof FolderUnlockError) … }` would silently miss wrong-password errors.
    Object.setPrototypeOf(this, FolderUnlockError.prototype);
  }
}

/**
 * Enrol a brand-new protected folder: generate a random folder key + salt, derive the root key from
 * `folderPassword`, and wrap the folder key under it. Returns the `bundle` to persist on the folder
 * and the raw `folderKey` to hold in memory for the current unlock session. The password is never
 * stored; the folder key never leaves memory unwrapped.
 */
export async function createFolderKey(
  folderPassword: string,
  preferred: KdfId = 'argon2id',
): Promise<{ bundle: FolderKeyBundle; folderKey: Uint8Array }> {
  if (!folderPassword) throw new Error('folderPassword is required');
  const salt = generateSalt();
  const folderKey = generateDataKey();
  const { key: rootKey, kdf, params } = await deriveRootKey(folderPassword, salt, preferred);
  const wrappedKey = wrapDataKey(folderKey, rootKey);
  rootKey.fill(0);
  return {
    bundle: { v: FOLDER_KEY_BUNDLE_VERSION, salt: bytesToB64(salt), kdf, kdfParams: params, wrappedKey },
    folderKey,
  };
}

/**
 * Unlock a folder: re-derive the root key from the password + the bundle's salt/kdf and unwrap the
 * folder key. Throws `FolderUnlockError` on a wrong password or a tampered bundle (the GCM auth tag
 * fails). On success the returned key is valid only in memory for this session.
 */
export async function unlockFolderKey(
  folderPassword: string,
  bundle: FolderKeyBundle,
): Promise<Uint8Array> {
  if (!folderPassword) throw new FolderUnlockError('folderPassword is required');
  const parsed = parseFolderKeyBundle(bundle);
  if (!parsed) throw new FolderUnlockError('malformed folder key bundle');
  let rootKey: Uint8Array;
  try {
    rootKey = await deriveRootKeyWithKdf(folderPassword, b64ToBytes(parsed.salt), parsed.kdf, parsed.kdfParams);
  } catch {
    throw new FolderUnlockError('could not derive folder root key');
  }
  try {
    const fk = unwrapDataKey(parsed.wrappedKey, rootKey);
    rootKey.fill(0);
    return fk;
  } catch {
    rootKey.fill(0);
    throw new FolderUnlockError();
  }
}

/**
 * Re-wrap the SAME folder key under a NEW password (folder-password change). No note is
 * re-encrypted; only the wrapper + salt change. The caller must already hold the unlocked
 * `folderKey` (e.g. from `unlockFolderKey` with the old password).
 */
export async function rewrapFolderKey(
  folderKey: Uint8Array,
  newFolderPassword: string,
  preferred: KdfId = 'argon2id',
): Promise<FolderKeyBundle> {
  if (!newFolderPassword) throw new Error('newFolderPassword is required');
  if (!(folderKey instanceof Uint8Array) || folderKey.length === 0) {
    throw new Error('a valid unlocked folderKey is required');
  }
  const salt = generateSalt();
  const { key: rootKey, kdf, params } = await deriveRootKey(newFolderPassword, salt, preferred);
  const wrappedKey = wrapDataKey(folderKey, rootKey);
  rootKey.fill(0);
  return {
    v: FOLDER_KEY_BUNDLE_VERSION,
    salt: bytesToB64(salt),
    kdf,
    kdfParams: params,
    wrappedKey,
  };
}

/** True if `value` is a folder-wrapped (`v3f:`) content envelope. */
export const isFolderWrapped = (value: unknown): value is string =>
  typeof value === 'string' && value.startsWith(FOLDER_CONTENT_PREFIX);

/**
 * Seal a note field (`title`/`content`/…) under the folder key into a `v3f:` envelope. This is a
 * normal AES-256-GCM `v3:` envelope under the folder key with a distinguishing prefix, so the
 * decrypt path knows which key it needs.
 */
export function wrapNoteForFolder(plaintext: string, folderKey: Uint8Array): string {
  return FOLDER_CONTENT_PREFIX + encryptV3(plaintext, folderKey).slice(V3_PREFIX.length);
}

/**
 * Open a `v3f:` folder-wrapped field with the unlocked folder key. Throws on a non-`v3f:` value, a
 * wrong key, or tampered ciphertext (GCM auth failure).
 */
export function unwrapNoteForFolder(envelope: string, folderKey: Uint8Array): string {
  if (!isFolderWrapped(envelope)) throw new Error('not a folder-wrapped (v3f:) envelope');
  return decryptV3(V3_PREFIX + envelope.slice(FOLDER_CONTENT_PREFIX.length), folderKey);
}

/**
 * Validate/normalise an untrusted value into a `FolderKeyBundle` (e.g. read back from storage or a
 * decrypted folder note). Returns null if any required field is missing or of the wrong shape, so a
 * corrupt bundle is a clean "locked" rather than a crash.
 */
export function parseFolderKeyBundle(raw: unknown): FolderKeyBundle | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.v !== FOLDER_KEY_BUNDLE_VERSION) return null;
  if (typeof o.salt !== 'string' || !o.salt) return null;
  if (o.kdf !== 'argon2id' && o.kdf !== 'pbkdf2-sha256') return null;
  if (typeof o.wrappedKey !== 'string' || !o.wrappedKey.startsWith('v3w:')) return null;
  // Preserve validated KDF params when present (a tampered/garbage params object is dropped, so
  // unlock falls back to the legacy baselines rather than being broken by bad input).
  const kdfParams = parseKdfParams(o.kdf, o.kdfParams) ?? undefined;
  return { v: FOLDER_KEY_BUNDLE_VERSION, salt: o.salt, kdf: o.kdf, ...(kdfParams ? { kdfParams } : {}), wrappedKey: o.wrappedKey };
}

/** Serialise a bundle for storage as a single string (e.g. a folder-note field). */
export const serializeFolderKeyBundle = (bundle: FolderKeyBundle): string => JSON.stringify(bundle);

/** Parse a serialised bundle string back into a validated bundle (null on malformed input). */
export function deserializeFolderKeyBundle(serialized: unknown): FolderKeyBundle | null {
  if (typeof serialized !== 'string') return null;
  try {
    return parseFolderKeyBundle(JSON.parse(serialized));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Bundle storage on the project-folder note (ADR-0012 §Migration step 1)
// ---------------------------------------------------------------------------

/** Minimal structural shape: a note that may carry a serialized folder key bundle. */
export interface WithFolderKeyBundle {
  folderKeyBundle?: string | null;
}

/**
 * Read + validate the `FolderKeyBundle` stored on a (project-folder) note. Returns null if the note
 * has no bundle or the stored value is malformed — so a corrupt/absent bundle reads as "this folder
 * is not crypto-protected" rather than crashing.
 */
export const readFolderKeyBundleFromNote = (
  note: WithFolderKeyBundle | null | undefined,
): FolderKeyBundle | null =>
  note && typeof note === 'object' ? deserializeFolderKeyBundle(note.folderKeyBundle) : null;

/** True when a note carries a validly-shaped folder key bundle → it is a crypto-protected folder. */
export const noteHasFolderKeyBundle = (note: WithFolderKeyBundle | null | undefined): boolean =>
  readFolderKeyBundleFromNote(note) !== null;

/**
 * Return a COPY of `note` with the bundle stamped on (serialized). Pure — never mutates the input —
 * so it composes safely inside the stores' immutable update paths.
 */
export const withFolderKeyBundle = <T extends object>(
  note: T,
  bundle: FolderKeyBundle,
): T & { folderKeyBundle: string } => ({
  ...note,
  folderKeyBundle: serializeFolderKeyBundle(bundle),
});
