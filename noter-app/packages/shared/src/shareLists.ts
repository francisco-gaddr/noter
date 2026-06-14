/**
 * Single source of truth for "which task-lists can a calendar/CalDAV share expose?"
 *
 * A task-list is any note that is EITHER classified as a task_list (decrypt-aware,
 * via normalizeNoteType) OR that actually has tasks pointing to it (parentNoteId).
 * The brittle `note.type === 'task_list'` check used inline in the share pickers
 * missed lists whose type arrived still-encrypted or that are identified only by
 * their tasks — leaving the picker empty even though the Tasks screen showed lists.
 *
 * Locked-and-not-unlocked lists are excluded (a locked list must never be shareable).
 * Pure and dependency-light so both clients call exactly the same logic and it's
 * unit-testable.
 */
import { normalizeNoteType } from './noteType';
import { buildSecurityNoteMap, isReadableWithLocks, type SecurityNote } from './locks';

export interface ShareableList {
  id: string;
  name: string;
}

export interface ShareListTask {
  parentNoteId?: unknown;
}

export const listShareableTaskLists = (
  notes: SecurityNote[] | null | undefined,
  tasks: ShareListTask[] | null | undefined,
  unlockedIds: Iterable<string> = [],
): ShareableList[] => {
  const list = Array.isArray(notes) ? notes : [];
  const map = buildSecurityNoteMap(list as any);
  const unlocked = unlockedIds instanceof Set ? unlockedIds : new Set(unlockedIds);

  const listIdsWithTasks = new Set<string>();
  for (const t of Array.isArray(tasks) ? tasks : []) {
    const parent = t?.parentNoteId;
    if (parent) listIdsWithTasks.add(String(parent));
  }

  return list
    .filter((n) => {
      const id = String((n as any)?._id ?? '');
      if (!id) return false;
      const isList = normalizeNoteType((n as any).type) === 'task_list' || listIdsWithTasks.has(id);
      return isList && isReadableWithLocks(map.get(id), map, unlocked);
    })
    .map((n) => ({ id: String((n as any)._id), name: String((n as any).title || 'Namnlös lista') }));
};
