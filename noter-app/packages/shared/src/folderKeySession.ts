/**
 * folderKeySession — the in-memory session of unlocked folder keys (ADR-0012 Fas 2).
 *
 * After the user enters a locked folder's password the derived **folder key** (from
 * `unlockFolderKey`) is held here, keyed by folder id, for THIS session only. It is the folder
 * analogue of the UI's `unlockedProtectedNoteIds` set:
 *   - never persisted (no AsyncStorage / localStorage / IndexedDB / disk);
 *   - never logged (a key is raw bytes — never stringify or print it);
 *   - cleared on app-lock and logout (`clearAllFolderKeys`), so a fresh launch starts fully locked.
 *
 * Both stores read through `getFolderKey(folderId)` (fed into `materializeFolderField`) and write
 * through it (fed into `wrapNoteForFolder`). Keeping it framework-free + in one module means there
 * is a single place that owns the lifetime of these secrets.
 *
 * Memory hygiene: the session owns a *copy* of each key (so callers can't mutate the stored bytes)
 * and zeroes the bytes when a key is removed/replaced, to minimise how long a key lingers in memory.
 */

import { findBlockingLockedAncestor, buildSecurityNoteMap, type SecurityNote } from './locks';

interface SessionEntry {
  key: Uint8Array;
  /** Absolute epoch-ms after which the key is treated as gone. 0 = never expires. */
  expiresAt: number;
}

const sessionKeys = new Map<string, SessionEntry>();

/**
 * Absolute lifetime (ms) of an unlocked folder key, independent of UI activity. This is a
 * DEFENSE-IN-DEPTH backstop beneath the UI's idle re-lock: if a lifecycle hook never fires (the app
 * is backgrounded without calling `clearAllFolderKeys`, a hook is mis-wired, etc.) the key still
 * stops being usable after this long. The UI idle re-lock (shorter) is the primary control; this is
 * the floor. Configurable via {@link configureFolderKeyTtl}; default 30 minutes.
 */
export const DEFAULT_FOLDER_KEY_TTL_MS = 30 * 60 * 1000;
let ttlMs = DEFAULT_FOLDER_KEY_TTL_MS;

/** Override the absolute folder-key TTL (ms). `<= 0` disables expiry (NOT recommended outside tests). */
export const configureFolderKeyTtl = (ms: number): void => {
  ttlMs = Number.isFinite(ms) && ms > 0 ? ms : 0;
};

const isValidId = (folderId: unknown): folderId is string =>
  typeof folderId === 'string' && folderId.length > 0;

const isValidKey = (key: unknown): key is Uint8Array =>
  key instanceof Uint8Array && key.length > 0;

const isExpired = (entry: SessionEntry): boolean => entry.expiresAt !== 0 && Date.now() >= entry.expiresAt;

/** Return the live entry for `folderId`, lazily zeroing + evicting it first if it has expired. */
const liveEntry = (folderId: string): SessionEntry | undefined => {
  const entry = sessionKeys.get(folderId);
  if (!entry) return undefined;
  if (isExpired(entry)) {
    entry.key.fill(0);
    sessionKeys.delete(folderId);
    return undefined;
  }
  return entry;
};

/**
 * Store the unlocked folder key for `folderId` (replacing and zeroing any previous one). Stores a
 * copy so the caller can dispose of theirs, and stamps it with the absolute TTL. Throws on an empty
 * id or an empty/invalid key so a wiring bug surfaces loudly rather than silently leaving a folder
 * un-keyed.
 */
export const setFolderKey = (folderId: string, key: Uint8Array): void => {
  if (!isValidId(folderId)) throw new Error('setFolderKey: folderId must be a non-empty string');
  if (!isValidKey(key)) throw new Error('setFolderKey: key must be a non-empty Uint8Array');
  const previous = sessionKeys.get(folderId);
  if (previous) previous.key.fill(0);
  sessionKeys.set(folderId, { key: key.slice(), expiresAt: ttlMs > 0 ? Date.now() + ttlMs : 0 }); // own a copy
};

/** The unlocked folder key for `folderId`, or `undefined` if not unlocked (or its TTL has lapsed). */
export const getFolderKey = (folderId: string): Uint8Array | undefined =>
  isValidId(folderId) ? liveEntry(folderId)?.key : undefined;

/** Whether `folderId` currently has a live (non-expired) unlocked key in the session. */
export const hasFolderKey = (folderId: string): boolean =>
  isValidId(folderId) && liveEntry(folderId) !== undefined;

/** Re-lock a single folder: zero its key bytes and drop it. No-op if it wasn't unlocked. */
export const clearFolderKey = (folderId: string): void => {
  if (!isValidId(folderId)) return;
  const entry = sessionKeys.get(folderId);
  if (entry) {
    entry.key.fill(0);
    sessionKeys.delete(folderId);
  }
};

/**
 * Re-lock EVERY folder: zero all key bytes and empty the session. Call on app-lock / logout
 * (mirrors clearing `unlockedProtectedNoteIds`).
 */
export const clearAllFolderKeys = (): void => {
  sessionKeys.forEach((entry) => entry.key.fill(0));
  sessionKeys.clear();
};

/**
 * Proactively zero + evict every folder key whose TTL has lapsed. `getFolderKey`/`hasFolderKey`
 * already evict lazily on access; call this from an idle tick / app-state change to drop expired
 * keys even when nothing reads them. Returns how many were swept.
 */
export const sweepExpiredFolderKeys = (): number => {
  let swept = 0;
  sessionKeys.forEach((entry, folderId) => {
    if (isExpired(entry)) {
      entry.key.fill(0);
      sessionKeys.delete(folderId);
      swept += 1;
    }
  });
  return swept;
};

/** Ids of the currently-unlocked folders (no secret material). For diagnostics / UI gating. */
export const unlockedFolderIds = (): string[] => {
  sweepExpiredFolderKeys();
  return Array.from(sessionKeys.keys());
};

/** Number of folders currently unlocked in the session (diagnostics / tests). */
export const folderKeySessionSize = (): number => {
  sweepExpiredFolderKeys();
  return sessionKeys.size;
};

// Ancestor resolution must locate the owning *crypto* folder regardless of UI unlock state — the
// presence of a session key (below) is what actually gates readability — so the unlocked-set is
// always empty here. findBlockingLockedAncestor only reads it, so one shared frozen set is safe.
const NO_UI_UNLOCKS: ReadonlySet<string> = new Set<string>();

/**
 * Resolve the session folder key that governs `note` — the key its nearest crypto-protected (locked)
 * ancestor folder is currently unlocked under, or `undefined` if none is. The single source for
 * "which folder key, if any, applies to this note", shared by the read path (→ `materializeFolderField`)
 * and the save-path seal (→ `sealNoteFieldForWrite`):
 *
 *  - no locked ancestor folder              → `undefined` (an ordinary note; the dataKey path).
 *  - a locked ancestor but no session key   → `undefined` (folder is masked but not unlocked, or is
 *                                             lock-only and not crypto-enrolled → stays masked).
 *  - a locked ancestor WITH a session key   → that folder's unlocked key.
 */
export function resolveSessionFolderKeyForNote<T extends SecurityNote>(
  note: T | undefined,
  noteMap: Map<string, T>,
): Uint8Array | undefined {
  const owner = findBlockingLockedAncestor(note, noteMap, NO_UI_UNLOCKS as Set<string>);
  return owner ? getFolderKey(String(owner._id)) : undefined;
}

/**
 * Create-time variant of {@link resolveSessionFolderKeyForNote}: the save-path seal needs the folder
 * key for a note that does NOT exist yet, so it resolves from the note's intended `parentId` against
 * the current `notes` list. Returns the session key of the nearest crypto-protected ancestor of
 * `parentId` (inclusive), or `undefined` for a root-level note / no enrolled+unlocked ancestor.
 *
 * Encapsulates the one subtlety of the write path — resolving against a not-yet-existing note — so the
 * stores' `createNote` can pass `resolveSessionFolderKeyForNewNote(parentId, get().notes)` straight to
 * the api layer's seal argument. Returns `undefined` (the dataKey path) for all data until a folder is
 * enrolled, so wiring it in is a true no-op for existing notes.
 */
export function resolveSessionFolderKeyForNewNote<T extends SecurityNote>(
  parentId: string | null | undefined,
  notes: T[],
): Uint8Array | undefined {
  if (!parentId) return undefined; // a root-level note belongs to no folder
  const noteMap = buildSecurityNoteMap(notes);
  // The new note isn't in the map; resolve from a synthetic, unlocked leaf whose parent is `parentId`,
  // so findBlockingLockedAncestor walks parentId's chain for the nearest locked (crypto) folder.
  const synthetic = { _id: '__pending__', parentId, locked: false } as unknown as T;
  return resolveSessionFolderKeyForNote(synthetic, noteMap);
}
