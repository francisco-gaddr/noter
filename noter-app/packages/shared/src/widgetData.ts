import type { Task } from './types';

/**
 * Pure widget view-model. The native widgets (iOS/macOS WidgetKit, Android App
 * Widget) render whatever this produces; keeping the sort/filter logic here means
 * one tested implementation drives every platform and the app's own snapshot
 * writer. No platform APIs here on purpose.
 */

export type WidgetSort = 'priority' | 'time';

export interface WidgetTask {
  id: string;
  title: string;
  priority: 'low' | 'medium' | 'high';
  dueDate: string | null;
  completed: boolean;
  listId: string | null;
}

export interface WidgetQuery {
  /** Restrict to one task list (parentNoteId). Omit/null = all lists. */
  listId?: string | null;
  sort?: WidgetSort;
  /** Default false: completed tasks are hidden in the widget. */
  includeCompleted?: boolean;
  /** Cap the rows the widget renders (small widgets show few). */
  limit?: number;
}

/**
 * Sort rank for a task priority: high(0) → medium(1) → low(2). Unknown/undefined
 * sorts as medium. Single source of truth for priority ordering across the app.
 */
export const priorityRank = (priority: unknown): number =>
  priority === 'high' ? 0 : priority === 'low' ? 2 : 1;

const dueTime = (d: string | null): number => {
  if (!d) return Number.POSITIVE_INFINITY; // undated tasks sort last
  const t = new Date(d).getTime();
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
};

const isDeleted = (t: Task): boolean => t.deleted === true || t.deleted === 'true';

/** Map a Task to the minimal widget row (no description/notes — titles only). */
export const toWidgetTask = (task: Task): WidgetTask => ({
  id: task._id,
  title: task.title || '',
  priority: task.priority ?? 'medium',
  dueDate: task.dueDate ?? null,
  completed: !!task.completed,
  listId: task.parentNoteId ?? null,
});

/**
 * Build the ordered, filtered widget rows. Sorting is stable and total:
 *  - 'priority': high→low, then earliest due date, then title.
 *  - 'time':     earliest due date, then priority, then title.
 */
export const toWidgetTasks = (tasks: Task[], query: WidgetQuery = {}): WidgetTask[] => {
  const { listId = null, sort = 'priority', includeCompleted = false, limit } = query;

  const rows = tasks
    .filter((t) => !isDeleted(t))
    .filter((t) => (includeCompleted ? true : !t.completed))
    .filter((t) => (listId ? (t.parentNoteId ?? null) === listId : true))
    .map(toWidgetTask);

  rows.sort((a, b) => {
    const byPriority = priorityRank(a.priority) - priorityRank(b.priority);
    const byTime = dueTime(a.dueDate) - dueTime(b.dueDate);
    const byTitle = a.title.localeCompare(b.title);
    if (sort === 'time') return byTime || byPriority || byTitle;
    return byPriority || byTime || byTitle;
  });

  return typeof limit === 'number' && limit >= 0 ? rows.slice(0, limit) : rows;
};

// ---------------------------------------------------------------------------
// Snapshot the app writes to the OS-shared container for the widget to read.
// Versioned so the native decoder can evolve. Carries only what the widget shows
// (task titles + metadata), never note bodies.
// ---------------------------------------------------------------------------
export const WIDGET_SNAPSHOT_VERSION = 1;

export interface WidgetSnapshot {
  version: number;
  generatedAt: string;
  /** Task lists, for the widget's list filter. */
  lists: { id: string; name: string }[];
  tasks: WidgetTask[];
}

export const buildWidgetSnapshot = (
  tasks: Task[],
  lists: { id: string; name: string }[],
  generatedAt: string,
  query: WidgetQuery = {},
): WidgetSnapshot => ({
  version: WIDGET_SNAPSHOT_VERSION,
  generatedAt,
  lists,
  tasks: toWidgetTasks(tasks, query),
});
