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

import { findBlockingLockedAncestor, type SecurityNote } from './locks';

const sessionKeys = new Map<string, Uint8Array>();

const isValidId = (folderId: unknown): folderId is string =>
  typeof folderId === 'string' && folderId.length > 0;

const isValidKey = (key: unknown): key is Uint8Array =>
  key instanceof Uint8Array && key.length > 0;

/**
 * Store the unlocked folder key for `folderId` (replacing and zeroing any previous one). Stores a
 * copy so the caller can dispose of theirs. Throws on an empty id or an empty/invalid key so a
 * wiring bug surfaces loudly rather than silently leaving a folder un-keyed.
 */
export const setFolderKey = (folderId: string, key: Uint8Array): void => {
  if (!isValidId(folderId)) throw new Error('setFolderKey: folderId must be a non-empty string');
  if (!isValidKey(key)) throw new Error('setFolderKey: key must be a non-empty Uint8Array');
  const previous = sessionKeys.get(folderId);
  if (previous) previous.fill(0);
  sessionKeys.set(folderId, key.slice()); // own a copy
};

/** The unlocked folder key for `folderId`, or `undefined` if the folder is not unlocked. */
export const getFolderKey = (folderId: string): Uint8Array | undefined =>
  isValidId(folderId) ? sessionKeys.get(folderId) : undefined;

/** Whether `folderId` currently has an unlocked key in the session. */
export const hasFolderKey = (folderId: string): boolean =>
  isValidId(folderId) && sessionKeys.has(folderId);

/** Re-lock a single folder: zero its key bytes and drop it. No-op if it wasn't unlocked. */
export const clearFolderKey = (folderId: string): void => {
  if (!isValidId(folderId)) return;
  const key = sessionKeys.get(folderId);
  if (key) {
    key.fill(0);
    sessionKeys.delete(folderId);
  }
};

/**
 * Re-lock EVERY folder: zero all key bytes and empty the session. Call on app-lock / logout
 * (mirrors clearing `unlockedProtectedNoteIds`).
 */
export const clearAllFolderKeys = (): void => {
  sessionKeys.forEach((key) => key.fill(0));
  sessionKeys.clear();
};

/** Ids of the currently-unlocked folders (no secret material). For diagnostics / UI gating. */
export const unlockedFolderIds = (): string[] => Array.from(sessionKeys.keys());

/** Number of folders currently unlocked in the session (diagnostics / tests). */
export const folderKeySessionSize = (): number => sessionKeys.size;

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
