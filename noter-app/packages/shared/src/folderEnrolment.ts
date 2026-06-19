// ---------------------------------------------------------------------------
// Per-folder encryption — enrolment / unlock orchestration (ADR-0012 Fas 2.8)
// ---------------------------------------------------------------------------
//
// UI-agnostic, headlessly-testable security logic that the device-cycle enrolment UI calls. It
// owns the exact, security-critical SEQUENCING the UI must not get wrong:
//
//   enrol   : derive a fresh folder key → register it in the in-memory session → stamp the wrapped
//             bundle on the folder note (so a corrupt UI can never persist a key it isn't holding).
//   unlock  : read the bundle off the note → derive the key from the password → register it.
//   change  : verify the OLD password → re-wrap the SAME key under the new one → refresh the session.
//
// Keeping this here (not duplicated in each app) means web + mobile enrol/unlock identically, the
// sequencing is covered by tests, and the UI shrinks to: prompt password → call → catch
// FolderUnlockError → persist the returned note. No `v3f:` note data is produced here — that happens
// later on the save path (sealNoteFieldForWrite) — so this whole module is safe to run headlessly.

import {
  createFolderKey,
  unlockFolderKey,
  rewrapFolderKey,
  readFolderKeyBundleFromNote,
  withFolderKeyBundle,
  FolderUnlockError,
  type FolderKeyBundle,
  type WithFolderKeyBundle,
} from './folderKey';
import { setFolderKey, clearFolderKey, hasFolderKey } from './folderKeySession';
import type { KdfId } from './cryptoV3';

export interface FolderEnrolment<T> {
  /** A COPY of the folder note with the new bundle stamped on — persist this via updateNote(). */
  note: T & { folderKeyBundle: string };
  /** The bundle now stored on the note (and matching the key registered in the session). */
  bundle: FolderKeyBundle;
}

/**
 * Enrol a project folder into per-folder encryption. Derives a fresh folder key from `password`,
 * registers it in the in-memory session (so notes saved into the folder seal to `v3f:` immediately),
 * and returns a COPY of the folder note with the wrapped-key bundle stamped on for the caller to
 * persist. Pure w.r.t. the input note (never mutates it).
 *
 * REFUSES to re-enrol a folder that already carries a valid bundle: a second enrol would mint a new
 * key and orphan every note already sealed under the old one (unrecoverable data loss). Rotate the
 * password with {@link changeFolderPassword} instead. Also throws on a blank password (delegated to
 * {@link createFolderKey}) — a folder is never enrolled passwordless.
 */
export async function enrolFolderPassword<T extends object>(
  folderId: string,
  folderNote: T,
  password: string,
  preferred: KdfId = 'argon2id',
): Promise<FolderEnrolment<T>> {
  if (!folderId) throw new Error('enrolFolderPassword: folderId is required');
  if (readFolderKeyBundleFromNote(folderNote as WithFolderKeyBundle)) {
    throw new Error(
      'enrolFolderPassword: folder is already enrolled — use changeFolderPassword to rotate the password',
    );
  }
  const { bundle, folderKey } = await createFolderKey(password, preferred);
  setFolderKey(folderId, folderKey);
  return { note: withFolderKeyBundle(folderNote, bundle), bundle };
}

/**
 * Unlock an already-enrolled folder for this session: read the bundle off the folder note, derive
 * the folder key from `password`, and register it in the session. Throws {@link FolderUnlockError}
 * on a wrong password, a tampered bundle, OR a folder that was never enrolled (no/malformed bundle)
 * — so the caller has one "cannot unlock" path and the folder stays locked. The session is left
 * untouched on any failure (the key is only registered after a successful unwrap).
 */
export async function unlockFolderWithPassword(
  folderId: string,
  folderNote: WithFolderKeyBundle | null | undefined,
  password: string,
): Promise<void> {
  if (!folderId) throw new Error('unlockFolderWithPassword: folderId is required');
  const bundle = readFolderKeyBundleFromNote(folderNote);
  if (!bundle) throw new FolderUnlockError('folder is not enrolled (no key bundle)');
  const folderKey = await unlockFolderKey(password, bundle); // throws FolderUnlockError on wrong pw
  setFolderKey(folderId, folderKey);
}

/**
 * Change a folder's password. Requires the OLD password and verifies it by unwrapping the current
 * bundle (so a warm session that lacks the password cannot silently re-key the folder), re-wraps the
 * SAME folder key under the new password (no note is re-encrypted — existing `v3f:` notes keep
 * reading), refreshes the session key, and returns the folder-note COPY with the new bundle to
 * persist. Throws {@link FolderUnlockError} if the folder isn't enrolled or the old password is wrong
 * (the note's bundle and the session are left unchanged in that case).
 */
export async function changeFolderPassword<T extends object>(
  folderId: string,
  folderNote: T & WithFolderKeyBundle,
  oldPassword: string,
  newPassword: string,
  preferred: KdfId = 'argon2id',
): Promise<FolderEnrolment<T>> {
  if (!folderId) throw new Error('changeFolderPassword: folderId is required');
  const current = readFolderKeyBundleFromNote(folderNote);
  if (!current) throw new FolderUnlockError('folder is not enrolled (no key bundle)');
  const folderKey = await unlockFolderKey(oldPassword, current); // verifies the old password first
  const bundle = await rewrapFolderKey(folderKey, newPassword, preferred);
  setFolderKey(folderId, folderKey); // same key, re-registered for this session
  return { note: withFolderKeyBundle(folderNote, bundle), bundle };
}

/**
 * Relock a single folder: drop its session key (the note's bundle stays, so re-unlocking needs the
 * password again). A no-op if the folder wasn't unlocked. Use on "lock this folder" / leaving it.
 */
export function lockFolder(folderId: string): void {
  clearFolderKey(folderId);
}

/** True when the folder currently holds an unlocked session key (readable without a re-prompt). */
export function isFolderUnlocked(folderId: string): boolean {
  return hasFolderKey(folderId);
}

/** The per-folder-encryption state of a project folder, for UI menu/gating decisions. */
export type FolderCryptoStatus = 'plain' | 'locked' | 'unlocked';

/**
 * Classify a (project-folder) note for the UI — the query side of the enrol/unlock/change actions, so
 * the folder menu and the open-folder gate read from one tested source instead of re-deriving it:
 *  - `'plain'`    — not enrolled (no/invalid bundle): an ordinary folder; offer "Lås med lösenord".
 *  - `'locked'`   — enrolled but the folder key is NOT in the session: prompt for the password before
 *                   showing contents; offer "Lås upp" / "Byt lösenord".
 *  - `'unlocked'` — enrolled AND the key is in the session: contents are readable.
 *
 * Robust to a null/malformed note or a missing `_id` (→ `'plain'` / `'locked'`, never throws).
 */
export function folderCryptoStatus(
  folder: (WithFolderKeyBundle & { _id?: string | null }) | null | undefined,
): FolderCryptoStatus {
  if (!readFolderKeyBundleFromNote(folder ?? null)) return 'plain';
  const id = folder && folder._id != null ? String(folder._id) : '';
  return id !== '' && hasFolderKey(id) ? 'unlocked' : 'locked';
}
