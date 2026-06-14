/**
 * Admin cleanup — find the junk that accumulates and can be safely removed in
 * bulk: completely-empty notes, titleless tasks, and completed tasks. One shared
 * source of truth so the mobile + Electron admin tools offer the exact same
 * categories and counts. Pure selectors (no IO) — the UI gathers ids and calls
 * the existing delete actions.
 */
import type { Note, Task } from './types';
import { isBlankNote, isBlankTask } from './displayFilters';

const notDeleted = (e: { deleted?: boolean | string }): boolean => e.deleted !== true && e.deleted !== 'true';

export interface CleanupCandidates<N extends { _id: string }, T extends { _id: string }> {
  /** Notes with no title and no visible content (folders are never "empty"). */
  emptyNotes: N[];
  /** Tasks with no title (junk from failed syncs). */
  blankTasks: T[];
  /** Completed tasks (optionally scoped to a list by the caller). */
  completedTasks: T[];
  /** Total removable items across all categories. */
  total: number;
}

/**
 * Compute removable items. `completedScope` (a parentNoteId) optionally limits the
 * completed-tasks bucket to one task-list; omit for "all lists".
 */
export const cleanupCandidates = <
  N extends Note & { _id: string },
  T extends Task & { _id: string },
>(
  notes: N[],
  tasks: T[],
  completedScope?: string | null,
): CleanupCandidates<N, T> => {
  const liveNotes = (notes || []).filter(notDeleted);
  const liveTasks = (tasks || []).filter(notDeleted);
  const emptyNotes = liveNotes.filter((n) => isBlankNote(n));
  const blankTasks = liveTasks.filter((t) => isBlankTask(t));
  const completedTasks = liveTasks.filter(
    (t) => t.completed && !isBlankTask(t) && (completedScope ? String(t.parentNoteId) === String(completedScope) : true),
  );
  return {
    emptyNotes,
    blankTasks,
    completedTasks,
    total: emptyNotes.length + blankTasks.length + completedTasks.length,
  };
};
