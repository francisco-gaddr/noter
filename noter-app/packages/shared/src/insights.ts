import type { Task, Note } from './types';
import type { AgentStatus, AiTaskSource } from './agentTasks';
import { isAiTask } from './agentTasks';

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

const DAY_MS = 24 * 60 * 60 * 1000;
// Local Y-M-D key (matches startOfDay, which is local) so day buckets don't shift
// by a timezone offset the way toISOString (UTC) would.
const isoDay = (ms: number): string => {
  const d = new Date(ms);
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
};
const tsMs = (d: string | null | undefined): number | null => {
  if (!d) return null;
  const t = new Date(d).getTime();
  return Number.isNaN(t) ? null : t;
};

/**
 * AI-agent orchestration stats — how the agents are configured and how they've run.
 * Powers the admin orchestration view: which sources/models are used, how many tasks
 * are delegated, how they're doing (done/error/scheduled), and total run volume.
 */
export interface AgentStats {
  /** Tasks delegated to the AI agent (assignee==='ai'). */
  delegated: number;
  byStatus: Record<AgentStatus, number>;
  bySource: Record<AiTaskSource | 'unset', number>;
  /** Models in use, most-used first. */
  byModel: { model: string; count: number }[];
  /** Sum of runCount across all delegated tasks. */
  totalRuns: number;
  /** Delegated tasks that completed successfully (status 'done'). */
  completedByAi: number;
  /** Delegated tasks whose last run errored. */
  errors: number;
  /** Delegated, not-done tasks waiting to run (scheduled or future). */
  scheduled: number;
  /** Delegated tasks set to run fully local (never synced). */
  localOnly: number;
  /** Delegated tasks set to run on the always-on backend (Pi). */
  onBackend: number;
}

export const computeAgentStats = (tasks: Task[]): AgentStats => {
  const out: AgentStats = {
    delegated: 0,
    byStatus: { idle: 0, scheduled: 0, running: 0, done: 0, error: 0 },
    bySource: { local: 0, hermes: 0, api: 0, unset: 0 },
    byModel: [],
    totalRuns: 0,
    completedByAi: 0,
    errors: 0,
    scheduled: 0,
    localOnly: 0,
    onBackend: 0,
  };
  const modelCounts = new Map<string, number>();
  for (const t of tasks) {
    if (isDeletedTask(t)) continue;
    const d = t.aiAgent;
    if (!isAiTask(d)) continue;
    out.delegated++;
    const status: AgentStatus = d.status ?? 'idle';
    out.byStatus[status] = (out.byStatus[status] ?? 0) + 1;
    out.bySource[d.source ?? 'unset'] = (out.bySource[d.source ?? 'unset'] ?? 0) + 1;
    out.totalRuns += d.runCount ?? 0;
    if (status === 'done' || (t.completed && status !== 'error')) out.completedByAi++;
    if (status === 'error') out.errors++;
    if (!t.completed && status !== 'done' && status !== 'error') out.scheduled++;
    if (d.localOnly) out.localOnly++;
    if (d.runOnBackend) out.onBackend++;
    if (d.model) modelCounts.set(d.model, (modelCounts.get(d.model) ?? 0) + 1);
  }
  out.byModel = Array.from(modelCounts.entries())
    .map(([model, count]) => ({ model, count }))
    .sort((a, b) => b.count - a.count);
  return out;
};

/**
 * Productivity throughput over time — measurable so improvements can be tracked.
 * Uses each task's updatedAt as the completion timestamp (best available proxy) and
 * createdAt for inflow. All windows are relative to the injected `now`.
 */
export interface ProductivityStats {
  completedLast7: number;
  completedLast30: number;
  createdLast7: number;
  /** completed in last 7d / created in last 7d (inflow vs outflow), capped sensibly. */
  throughputRatio7: number;
  /** Completed-count per calendar day for the last 7 days (oldest first). */
  perDay: { date: string; completed: number }[];
  /** Consecutive days up to and including today with ≥1 completion. */
  currentStreakDays: number;
  /** Average completions per day that had ≥1 completion, over the last 30 days. */
  avgPerActiveDay: number;
}

export const computeProductivityStats = (tasks: Task[], now: Date): ProductivityStats => {
  const todayStart = startOfDay(now);
  const since7 = todayStart - 6 * DAY_MS; // start of the 7-day window (incl. today)
  const since30 = todayStart - 29 * DAY_MS;
  const live = tasks.filter((t) => !isDeletedTask(t));

  const perDayMap = new Map<string, number>();
  for (let i = 0; i < 7; i += 1) perDayMap.set(isoDay(since7 + i * DAY_MS), 0);

  let completedLast7 = 0;
  let completedLast30 = 0;
  let createdLast7 = 0;
  const activeDays30 = new Set<string>();

  for (const t of live) {
    const created = tsMs(t.createdAt);
    if (created !== null && created >= since7) createdLast7++;
    if (!t.completed) continue;
    const done = tsMs(t.updatedAt) ?? tsMs(t.createdAt);
    if (done === null) continue;
    if (done >= since30) { completedLast30++; activeDays30.add(isoDay(done)); }
    if (done >= since7) {
      completedLast7++;
      const key = isoDay(done);
      if (perDayMap.has(key)) perDayMap.set(key, (perDayMap.get(key) ?? 0) + 1);
    }
  }

  const perDay = Array.from(perDayMap.entries()).map(([date, completed]) => ({ date, completed }));

  // Current streak: walk back from today while that day had ≥1 completion.
  let streak = 0;
  for (let i = perDay.length - 1; i >= 0; i -= 1) {
    if (perDay[i].completed > 0) streak++; else break;
  }

  const throughputRatio7 = createdLast7 > 0 ? completedLast7 / createdLast7 : completedLast7 > 0 ? 1 : 0;
  const avgPerActiveDay = activeDays30.size > 0 ? completedLast30 / activeDays30.size : 0;

  return { completedLast7, completedLast30, createdLast7, throughputRatio7, perDay, currentStreakDays: streak, avgPerActiveDay };
};
