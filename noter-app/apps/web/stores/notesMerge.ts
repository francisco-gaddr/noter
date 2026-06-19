import { Note } from '@repo/shared';

/**
 * Apply an incoming `note:updated` realtime event to the CURRENT notes array.
 *
 * Returns the new notes array, or `null` when the update must be IGNORED because the local
 * copy is strictly newer (last-writer-wins by `updatedAt`).
 *
 * Why this is its own pure function (regression guard for fix 49661ea — "rAF lost-write"):
 * the `note:updated` handler decrypts against a snapshot taken synchronously, then applies the
 * result inside a deferred `requestAnimationFrame`. The apply must substitute ONLY the updated
 * note into whatever `state.notes` is AT APPLY TIME — never replace the whole array with the
 * pre-captured snapshot — otherwise a note created/imported between capture and apply is
 * silently dropped. Keeping the merge here, decoupled from the socket/rAF plumbing, lets us
 * test that invariant directly and stops it from regressing.
 *
 * - Existing note → substituted in place (order preserved).
 * - Unknown note → prepended (newest-first), every other note kept.
 * - Local strictly newer (`localTime > remoteTime`) → `null` (caller leaves state untouched).
 * - Equal timestamps → remote accepted (idempotent; matches "remote is newer-or-equal wins").
 * - Unparseable `updatedAt` on either side → comparison is skipped (NaN), remote accepted; the
 *   function never throws on malformed timestamps.
 */
export function applyNoteUpdate(currentNotes: Note[], incoming: Note): Note[] | null {
  const currentNote = currentNotes.find((n) => n._id === incoming._id);
  if (currentNote) {
    const localTime = new Date(currentNote.updatedAt as any).getTime();
    const remoteTime = new Date(incoming.updatedAt as any).getTime();
    // NaN comparisons are always false, so a malformed timestamp falls through to "accept remote".
    if (localTime > remoteTime) {
      return null; // local strictly newer — ignore the remote echo
    }
  }
  return currentNotes.some((n) => n._id === incoming._id)
    ? currentNotes.map((n) => (n._id === incoming._id ? incoming : n))
    : [incoming, ...currentNotes];
}
