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

/** Short, firm instruction injected into every agent system prompt. */
export const AGENT_LOCK_POLICY =
  'SÄKERHET: Du får ALDRIG läsa, avkryptera, sammanfatta eller på annat sätt komma åt innehållet i låsta anteckningar eller låsta projektmappar (eller något som ligger i en låst mapp). Sådant innehåll är otillgängligt för dig — försök inte kringgå det. Om något du behöver är låst: tala om för användaren att det är låst och be hen låsa upp det, fortsätt annars utan det.';
