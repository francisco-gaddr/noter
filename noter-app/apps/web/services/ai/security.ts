export type SecurityNote = {
  _id: string;
  parentId?: string | null;
  locked?: boolean | string | number | null;
  type?: string;
  title?: string;
  content?: string;
  tags?: string[];
  icon?: string;
};

const parseLockedFlag = (value: unknown): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') return value === 'true';
  return false;
};

export const buildSecurityNoteMap = <T extends SecurityNote>(notes: T[]) => {
  const map = new Map<string, T>();
  for (const note of notes) map.set(note._id, note);
  return map;
};

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
    if (parseLockedFlag(current.locked) && !unlockedIds.has(current._id)) return current;
    if (!current.parentId) break;
    current = noteMap.get(String(current.parentId));
  }
  return null;
};

export const isReadableWithLocks = <T extends SecurityNote>(
  note: T | undefined,
  noteMap: Map<string, T>,
  unlockedIds: Set<string> = new Set(),
) => !findBlockingLockedAncestor(note, noteMap, unlockedIds);

export const maskLockedHierarchy = <T extends SecurityNote>(
  notes: T[],
  unlockedIds: Set<string> = new Set(),
): T[] => {
  const noteMap = buildSecurityNoteMap(notes);
  return notes.map((note) => {
    const blocked = findBlockingLockedAncestor(note, noteMap, unlockedIds);
    if (!blocked) return note;
    const isDirectlyLockedProject = blocked._id === note._id && note.type === 'project';
    return {
      ...note,
      title: isDirectlyLockedProject ? note.title : 'Låst anteckning',
      content: '',
      tags: [],
      icon: undefined,
      locked: true,
    };
  });
};
