export const normalizeNoteType = (value: unknown): string => {
  if (typeof value !== 'string') return 'note';
  let normalized = value.trim().toLowerCase();
  
  // Remove surrounding quotes if present
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

  normalized = normalized.replace(/\s+/g, '_');
  normalized = normalized.replace(/-/g, '_');

  // Check for common variations of 'project'
  if (normalized === 'projectfolder' || normalized === 'project_folder') return 'project';
  if (normalized.includes('project') || normalized.includes('folder')) return 'project';
  if (normalized === 'folder') return 'project';
  if (normalized === 'dir' || normalized === 'directory') return 'project';
  
  // Check for task lists
  if (normalized === 'tasklist' || normalized === 'task-list' || normalized === 'task_list') return 'task_list';
  if (normalized.includes('task') && normalized.includes('list')) return 'task_list';

  return normalized || 'note';
};

export const normalizeId = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  let normalized = value.trim();
  if (!normalized) return null;
  
  // Remove surrounding quotes if present
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
  
  return normalized || null;
};
