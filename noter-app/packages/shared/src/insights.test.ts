import { computeTaskInsights, computeNoteInsights, computeAgentStats, computeProductivityStats } from './insights';
import type { Task, Note } from './types';
import type { AiTaskDelegation } from './agentTasks';

const NOW = new Date('2026-06-13T12:00:00.000Z');
const at = (iso: string) => iso;
const task = (over: Partial<Task>): Task => ({
  _id: Math.random().toString(36).slice(2),
  userId: 'u', title: 'T', completed: false,
  createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-06-01T00:00:00.000Z',
  ...over,
});

describe('computeTaskInsights', () => {
  it('buckets overdue / today / week and priorities for outstanding tasks', () => {
    const tasks = [
      task({ completed: true }),
      task({ dueDate: at('2026-06-10T09:00:00.000Z'), priority: 'high' }), // overdue
      task({ dueDate: at('2026-06-13T20:00:00.000Z'), priority: 'low' }),  // today
      task({ dueDate: at('2026-06-16T09:00:00.000Z'), priority: 'medium' }), // this week
      task({ dueDate: null, priority: 'high' }), // undated active
    ];
    const r = computeTaskInsights(tasks, NOW);
    expect(r.total).toBe(5);
    expect(r.completed).toBe(1);
    expect(r.active).toBe(4);
    expect(r.overdue).toBe(1);
    expect(r.dueToday).toBe(1);
    expect(r.dueThisWeek).toBe(2); // today(1) + the 06-16 task(1); overdue excluded
    expect(r.byPriority).toEqual({ high: 2, medium: 1, low: 1 });
    expect(r.completionRate).toBeCloseTo(0.2);
  });

  it('ignores soft-deleted tasks and completed tasks in priority buckets', () => {
    const tasks = [
      task({ deleted: true, priority: 'high' }),
      task({ completed: true, priority: 'high' }),
      task({ priority: 'high' }),
    ];
    const r = computeTaskInsights(tasks, NOW);
    expect(r.total).toBe(2); // deleted excluded
    expect(r.byPriority.high).toBe(1); // only the active one
  });

  it('returns a zero completion rate with no tasks', () => {
    expect(computeTaskInsights([], NOW).completionRate).toBe(0);
  });
});

describe('computeNoteInsights', () => {
  it('counts notes vs projects vs task lists', () => {
    const notes = [
      { type: 'note' }, { type: 'note' }, { type: 'project' }, { type: 'task_list' }, {},
    ] as unknown as Note[];
    expect(computeNoteInsights(notes)).toEqual({ notes: 3, projects: 1, taskLists: 1 });
  });
});

const ai = (over: Partial<AiTaskDelegation>): AiTaskDelegation => ({ assignee: 'ai', ...over });

describe('computeAgentStats', () => {
  it('aggregates delegation by status, source, model + run volume', () => {
    const tasks = [
      task({ aiAgent: ai({ source: 'hermes', model: 'qwen2.5:3b', status: 'done', runCount: 2 }), completed: true }),
      task({ aiAgent: ai({ source: 'hermes', model: 'qwen2.5:3b', status: 'scheduled', runCount: 0 }) }),
      task({ aiAgent: ai({ source: 'api', model: 'gpt-4o-mini', status: 'error', runCount: 1, localOnly: true }) }),
      task({ aiAgent: ai({ status: 'idle', runOnBackend: true }) }), // unset source
      task({ aiAgent: { assignee: 'user' } as AiTaskDelegation }), // not an AI task
      task({}), // no delegation
    ];
    const r = computeAgentStats(tasks);
    expect(r.delegated).toBe(4);
    expect(r.bySource).toEqual({ hermes: 2, api: 1, local: 0, unset: 1 });
    expect(r.byStatus.done).toBe(1);
    expect(r.byStatus.error).toBe(1);
    expect(r.totalRuns).toBe(3);
    expect(r.completedByAi).toBe(1);
    expect(r.errors).toBe(1);
    expect(r.scheduled).toBe(2); // scheduled + idle (not done/error, not completed)
    expect(r.localOnly).toBe(1);
    expect(r.onBackend).toBe(1);
    expect(r.byModel[0]).toEqual({ model: 'qwen2.5:3b', count: 2 });
  });
  it('ignores deleted tasks', () => {
    expect(computeAgentStats([task({ deleted: true, aiAgent: ai({ status: 'done' }) })]).delegated).toBe(0);
  });
});

describe('computeProductivityStats', () => {
  it('counts throughput windows, per-day buckets and the current streak', () => {
    const tasks = [
      task({ completed: true, updatedAt: '2026-06-13T08:00:00.000Z', createdAt: '2026-06-12T00:00:00.000Z' }), // today
      task({ completed: true, updatedAt: '2026-06-12T08:00:00.000Z', createdAt: '2026-06-12T00:00:00.000Z' }), // yesterday
      task({ completed: true, updatedAt: '2026-05-20T08:00:00.000Z', createdAt: '2026-05-20T00:00:00.000Z' }), // within 30d (since=05-15)
      task({ completed: false, createdAt: '2026-06-13T00:00:00.000Z' }), // created today, open
    ];
    const r = computeProductivityStats(tasks, NOW);
    expect(r.completedLast7).toBe(2);
    expect(r.completedLast30).toBe(3); // today, yesterday, and 05-20 (all ≥ 05-15)
    expect(r.createdLast7).toBeGreaterThanOrEqual(3);
    expect(r.perDay).toHaveLength(7);
    expect(r.perDay[6]).toEqual({ date: '2026-06-13', completed: 1 }); // today is last bucket
    expect(r.currentStreakDays).toBe(2); // today + yesterday
  });
  it('is all-zero with no completions', () => {
    const r = computeProductivityStats([task({})], NOW);
    expect(r.completedLast7).toBe(0);
    expect(r.currentStreakDays).toBe(0);
    expect(r.avgPerActiveDay).toBe(0);
  });
});
