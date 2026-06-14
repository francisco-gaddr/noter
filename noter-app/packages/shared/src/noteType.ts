import { isAnyCiphertext, safeDecrypt } from './encrypt';

/**
 * Single source of truth for classifying a note's `type` into one of
 * 'project' | 'task_list' | 'note'.
 *
 * Critically it is **decrypt-aware**: a note's `type` can arrive still-encrypted
 * (E2E locked, or a sync/socket path that didn't decrypt it), in which case a
 * project folder's ciphertext type would otherwise read as a plain 'note' and the
 * folder leaks into the notes list instead of staying in the project dropdown.
 * We decrypt here before classifying so every call site agrees.
 *
 * Tolerant of quoting ("project"), separators (task-list / "task list"),
 * synonyms (folder → project) and casing.
 */
export const normalizeNoteType = (value: unknown): 'project' | 'task_list' | 'note' | string => {
  if (typeof value !== 'string') return 'note';
  let raw = value;
  if (isAnyCiphertext(raw)) raw = safeDecrypt(raw, raw);
  let normalized = raw.trim().toLowerCase();
  // Strip wrapping quotes/backticks the model or storage may have added.
  while (
    normalized.length >= 2 &&
    (
      (normalized.startsWith('"') && normalized.endsWith('"')) ||
      (normalized.startsWith("'") && normalized.endsWith("'")) ||
      (normalized.startsWith('`') && normalized.endsWith('`'))
    )
  ) {
    normalized = normalized.slice(1, -1).trim();
  }
  normalized = normalized.replace(/\s+/g, '_').replace(/-/g, '_');
  if (normalized === 'projectfolder' || normalized === 'project_folder') return 'project';
  if (normalized === 'tasklist' || normalized === 'task_list') return 'task_list';
  if (normalized.includes('task') && normalized.includes('list')) return 'task_list';
  if (normalized.includes('project') || normalized.includes('folder')) return 'project';
  if (normalized === 'project' || normalized === 'note') return normalized;
  return normalized || 'note';
};

/** True when a `type` value (possibly still-encrypted) is a project folder. */
export const isProjectType = (type: unknown): boolean => normalizeNoteType(type) === 'project';
/** True when a `type` value (possibly still-encrypted) is a task list. */
export const isTaskListType = (type: unknown): boolean => normalizeNoteType(type) === 'task_list';
