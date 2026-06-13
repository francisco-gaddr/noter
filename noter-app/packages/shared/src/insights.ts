import type { Task, Note } from './types';

/**
 * Pure productivity-insight computations for the dashboard. Date-injected and
 * side-effect-free so they're unit-tested and reusable across mobile + web.
 */

export interface TaskInsights {
  total: number;
  completed: number;
  active: number;
  overdue: number;
  dueToday: number;
  dueThisWeek: number;
  completionRate: number; // 0..1
  byPriority: { high: number; medium: number; low: number };
}

export interface NoteInsights {
  notes: number;
  projects: number;
  taskLists: number;
}

const isDeletedTask = (t: Task): boolean => t.deleted === true || t.deleted === 'true';

const startOfDay = (d: Date): number => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
};

const dueMs = (d: string | null | undefined): number | null => {
  if (!d) return null;
  const t = new Date(d).getTime();
  return Number.isNaN(t) ? null : t;
};

export const computeTaskInsights = (tasks: Task[], now: Date): TaskInsights => {
  const todayStart = startOfDay(now);
  const todayEnd = todayStart + 24 * 60 * 60 * 1000;
  const weekEnd = todayStart + 7 * 24 * 60 * 60 * 1000;

  const live = tasks.filter((t) => !isDeletedTask(t));
  const insights: TaskInsights = {
    total: live.length,
    completed: 0,
    active: 0,
    overdue: 0,
    dueToday: 0,
    dueThisWeek: 0,
    completionRate: 0,
    byPriority: { high: 0, medium: 0, low: 0 },
  };

  for (const t of live) {
    if (t.completed) {
      insights.completed++;
      continue; // priority/due buckets describe outstanding work only
    }
    insights.active++;
    insights.byPriority[t.priority ?? 'medium']++;
    const due = dueMs(t.dueDate);
    if (due !== null) {
      if (due < todayStart) insights.overdue++;
      else if (due < todayEnd) insights.dueToday++;
      // dueThisWeek = upcoming within 7 days (incl. today), excludes overdue.
      if (due >= todayStart && due < weekEnd) insights.dueThisWeek++;
    }
  }

  insights.completionRate = live.length ? insights.completed / live.length : 0;
  return insights;
};

export const computeNoteInsights = (notes: Note[]): NoteInsights => {
  const out: NoteInsights = { notes: 0, projects: 0, taskLists: 0 };
  for (const n of notes) {
    const type = (n as any).type;
    if (type === 'project') out.projects++;
    else if (type === 'task_list') out.taskLists++;
    else out.notes++;
  }
  return out;
};
