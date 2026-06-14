/**
 * Display filters — what should actually appear in a list, shared across mobile,
 * web and Electron so "hide empty / keep folders out of notes" behaves identically.
 *
 * Two recurring asks this addresses:
 *  1. Completely-empty notes/tasks (junk left by failed syncs / the old blank-data
 *     bug) must NOT clutter the lists — only entries with real content show.
 *  2. Project folders must never appear among plain notes; the notes list shows
 *     only `type === 'note'`.
 */
import type { Note, Task } from './types';
import { normalizeNoteType } from './noteType';

/** Strip HTML tags + entities + whitespace; '' means visually empty. */
const stripToText = (raw: string): string =>
  raw
    .replace(/<[^>]*>/g, ' ') // tags
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * True when a note's rich-text content has no visible text. Handles plain strings,
 * HTML (`<p></p>`, `<p><br></p>`), and Slate/JSON docs whose only text nodes are ''.
 */
export const noteContentIsEmpty = (content: unknown): boolean => {
  if (typeof content !== 'string') return true;
  const trimmed = content.trim();
  if (trimmed === '') return true;
  // Slate / ProseMirror JSON: empty iff no non-empty "text" field anywhere.
  if ((trimmed.startsWith('[') || trimmed.startsWith('{')) && trimmed.includes('"text"')) {
    const texts = trimmed.match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/g) || [];
    const anyText = texts.some((m) => {
      const v = m.replace(/^"text"\s*:\s*"/, '').replace(/"$/, '');
      return v.replace(/\\[nrt]/g, '').trim() !== '';
    });
    return !anyText;
  }
  return stripToText(trimmed) === '';
};

// All three use the decrypt-aware normalizeNoteType so a still-encrypted `type`
// (E2E locked / un-decrypted sync path) is classified correctly — otherwise a
// project folder's ciphertext type reads as a plain note and leaks into the list.
/** Project folder (a container, never shown among plain notes). */
export const isProjectFolder = (note: Pick<Note, 'type'>): boolean => normalizeNoteType(note.type) === 'project';
/** Task-list folder (a container for tasks). */
export const isTaskListFolder = (note: Pick<Note, 'type'>): boolean => normalizeNoteType(note.type) === 'task_list';
/** Plain note (the only kind that belongs in the notes list). */
export const isPlainNote = (note: Pick<Note, 'type'>): boolean => normalizeNoteType(note.type) === 'note';

/**
 * Completely-empty plain note: no title AND no visible content. Folders (project /
 * task_list) are never "empty" — they're containers — so they're excluded here.
 */
export const isBlankNote = (note: Pick<Note, 'title' | 'content' | 'type'>): boolean => {
  if (!isPlainNote(note)) return false;
  const titleEmpty = !((note.title ?? '').trim());
  return titleEmpty && noteContentIsEmpty(note.content);
};

/** A task with no title is junk. */
export const isBlankTask = (task: Pick<Task, 'title'>): boolean => !((task.title ?? '').trim());

const notDeleted = (x: { deleted?: boolean | string }): boolean =>
  x.deleted !== true && x.deleted !== 'true';

/**
 * The notes that belong in the notes list: plain notes, not deleted, not blank.
 * Projects and task-lists are intentionally excluded (they render in their own
 * sections), satisfying "project folders must never appear among notes".
 */
export const visibleNotes = <T extends Pick<Note, 'title' | 'content' | 'type' | 'deleted'>>(notes: T[]): T[] =>
  (notes || []).filter((n) => isPlainNote(n) && notDeleted(n) && !isBlankNote(n));

/** Tasks that belong in a task list: not deleted, not blank (titleless). */
export const visibleTasks = <T extends Pick<Task, 'title' | 'deleted'>>(tasks: T[]): T[] =>
  (tasks || []).filter((t) => notDeleted(t) && !isBlankTask(t));

/** Completed, non-deleted tasks (for bulk "clear completed"). */
export const completedTasks = <T extends Pick<Task, 'completed' | 'deleted'>>(tasks: T[]): T[] =>
  (tasks || []).filter((t) => notDeleted(t) && t.completed === true);
