/**
 * Locked-note enforcement — the single source of truth for "may this note (or its
 * ancestor folder) be read?". A note is locked when its `locked` flag is truthy and it
 * has NOT been unlocked by the user (password entered) this session. Locking is
 * hierarchical: a note inside a locked project/folder is itself unreadable.
 *
 * SECURITY INVARIANT (hard requirement): the AI — both the interactive chat and the
 * delegated/scheduled agent, on every platform AND the always-on backend — must NEVER
 * read or decrypt the content of a locked note/project. This module is the guard the
 * AI tool layer + agent memory enforce directly, so the protection does not depend on
 * incidental client-side store masking. Locked content stays encrypted/blank unless the
 * user unlocked it first.
 */
import { decrypt } from './encrypt';

export type SecurityNote = {
  _id: string;
  parentId?: string | null;
  locked?: boolean | string | number | null;
  /** Present (non-empty) on a password-protected note — a second lock signal. */
  password?: string | null;
  type?: string;
  title?: string;
  content?: string;
  tags?: string[];
  icon?: string;
};

/** Parse a `locked` flag that may be a boolean, number, plain string, or ciphertext. */
export const parseLockedFlag = (value: unknown): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    if (value === 'true') return true;
    if (value === 'false' || value === '') return false;
    try {
      return decrypt(value) === 'true';
    } catch {
      return false;
    }
  }
  return false;
};

/**
 * Any signal that a note is lock-protected: the locked flag OR a set password. Used as
 * the conservative server-side check (the backend has no unlock session, so any lock
 * signal means "do not read").
 */
export const hasLockSignal = (note: Pick<SecurityNote, 'locked' | 'password'>): boolean =>
  parseLockedFlag(note.locked) || (typeof note.password === 'string' && note.password.trim().length > 0);

export const buildSecurityNoteMap = <T extends SecurityNote>(notes: T[]) => {
  const map = new Map<string, T>();
  for (const note of notes) map.set(note._id, note);
  return map;
};

/** First locked-and-not-unlocked note walking up the parentId chain (or null). */
export const findBlockingLockedAncestor = <T extends SecurityNote>(
  note: T | undefined,
  noteMap: Map<string, T>,
  unlockedIds: Set<string> = new Set(),
): T | null => {
  let current: T | undefined = note;
  const seen = new Set<string>();
  while (current) {
    if (seen.has(current._id)) break;
    seen.add(current._id);
    if (hasLockSignal(current) && !unlockedIds.has(current._id)) return current;
    if (!current.parentId) break;
    current = noteMap.get(String(current.parentId));
  }
  return null;
};

/** True when the note and its whole ancestor chain are unlocked (safe to read). */
export const isReadableWithLocks = <T extends SecurityNote>(
  note: T | undefined,
  noteMap: Map<string, T>,
  unlockedIds: Set<string> = new Set(),
): boolean => !findBlockingLockedAncestor(note, noteMap, unlockedIds);

/** Blank the readable content of a single note (defense-in-depth before returning it). */
export const maskLockedNote = <T extends SecurityNote>(note: T): T => ({
  ...note,
  title: note.type === 'project' ? note.title : 'Låst anteckning',
  content: '',
  tags: [],
  icon: undefined,
  locked: true,
});

/** Mask every note whose hierarchy is locked-and-not-unlocked. */
export const maskLockedHierarchy = <T extends SecurityNote>(
  notes: T[],
  unlockedIds: Set<string> = new Set(),
): T[] => {
  const noteMap = buildSecurityNoteMap(notes);
  return notes.map((note) => (findBlockingLockedAncestor(note, noteMap, unlockedIds) ? maskLockedNote(note) : note));
};

/**
 * Keep only the notes the AI is allowed to read (whole chain unlocked). Use this in the
 * agent tool layer to filter list_* results and to guard get_* reads.
 */
export const filterReadableNotes = <T extends SecurityNote>(
  notes: T[],
  unlockedIds: Set<string> = new Set(),
): T[] => {
  const noteMap = buildSecurityNoteMap(notes);
  return notes.filter((n) => isReadableWithLocks(n, noteMap, unlockedIds));
};

/**
 * The unlock set the AI and the search/RAG index MUST use: ALWAYS EMPTY.
 *
 * A folder's UI unlock (the user entered the password to VIEW it this moment) is a
 * view-only grant — it is NEVER extended to automated readers. The interactive chat, the
 * delegated/scheduled agent, the placement resolver, the agent-memory layer AND the
 * embeddings/graph index all treat ANY lock-signalled note/folder as locked, regardless of
 * what the user currently has open. This is the hard "nothing ever leaks out of a locked
 * folder" invariant. NEVER pass the UI's `unlockedProtectedNoteIds` to an AI/index call site
 * — pass this instead (or omit the arg, which defaults to empty).
 */
export const AI_INDEX_NO_UNLOCK: ReadonlySet<string> = Object.freeze(new Set<string>());

/** filterReadableNotes for AI/index — hard-wired to the empty unlock set (locked = invisible). */
export const filterReadableForAI = <T extends SecurityNote>(notes: T[]): T[] =>
  filterReadableNotes(notes, AI_INDEX_NO_UNLOCK as Set<string>);

/** isReadableWithLocks for AI/index — hard-wired to the empty unlock set. */
export const isReadableForAI = <T extends SecurityNote>(
  note: T | undefined,
  noteMap: Map<string, T>,
): boolean => isReadableWithLocks(note, noteMap, AI_INDEX_NO_UNLOCK as Set<string>);

/**
 * Re-lock folders on leave. Given the full notes, the set the user currently has unlocked,
 * and the folder they are NAVIGATING TO (`activeProjectId`, or null for the all-notes view),
 * returns the new unlocked set that keeps unlocked ONLY the project folders on the path to
 * the active folder (ancestor-or-self). Every folder the user navigated AWAY from is removed
 * → it re-locks and its notes re-mask immediately. Non-folder unlocked notes are left as-is
 * (an individually-opened locked note re-masks anyway once its containing folder re-locks).
 */
export const relockFoldersOnLeave = <T extends SecurityNote>(
  notes: T[],
  unlockedIds: readonly string[],
  activeProjectId: string | null | undefined,
): string[] => {
  const map = buildSecurityNoteMap(notes);
  // The folders that may STAY unlocked: the active folder and all its ancestors.
  const keep = new Set<string>();
  let cur: T | undefined = activeProjectId ? map.get(String(activeProjectId)) : undefined;
  const seen = new Set<string>();
  while (cur && !seen.has(cur._id)) {
    seen.add(cur._id);
    keep.add(cur._id);
    cur = cur.parentId ? map.get(String(cur.parentId)) : undefined;
  }
  return (Array.isArray(unlockedIds) ? unlockedIds : []).filter((id) => {
    const note = map.get(String(id));
    const isFolder = note ? note.type === 'project' : false;
    // Keep non-folders untouched; keep folders only if on the active path.
    return !isFolder || keep.has(String(id));
  });
};

/**
 * Default idle window before an open password-protected folder re-locks itself while the app
 * stays in the FOREGROUND (the user is still in the app but hasn't interacted). The whole-app
 * lock has its own, usually longer, grace window; this only matters when the app-lock timing is
 * longer than this — the most sensitive surface shouldn't sit open for hours of inactivity.
 */
export const FOLDER_IDLE_RELOCK_MS = 5 * 60 * 1000;

/**
 * Decide whether an unlocked protected folder should re-lock due to FOREGROUND inactivity.
 * Pure (no UI/runtime) so the threshold logic is unit-tested in the blocking gate. `lastActivityAt`
 * is the epoch-ms timestamp of the last user interaction; returns true once `now` is at least
 * `thresholdMs` past it. A non-positive threshold disables the feature (always false), and
 * non-finite inputs are treated as "no idle yet" so a bad clock never force-locks the UI.
 */
export const shouldRelockOnIdle = (
  lastActivityAt: number,
  now: number,
  thresholdMs: number = FOLDER_IDLE_RELOCK_MS,
): boolean => {
  if (!Number.isFinite(lastActivityAt) || !Number.isFinite(now)) return false;
  if (!Number.isFinite(thresholdMs) || thresholdMs <= 0) return false;
  return now - lastActivityAt >= thresholdMs;
};

/** Short, firm instruction injected into every agent system prompt. */
export const AGENT_LOCK_POLICY =
  'SÄKERHET: Du får ALDRIG läsa, avkryptera, sammanfatta eller på annat sätt komma åt innehållet i låsta anteckningar eller låsta projektmappar (eller något som ligger i en låst mapp). Sådant innehåll är otillgängligt för dig — försök inte kringgå det. Om något du behöver är låst: tala om för användaren att det är låst och be hen låsa upp det, fortsätt annars utan det.';
