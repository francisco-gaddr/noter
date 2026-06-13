import { computeTaskInsights, computeNoteInsights } from './insights';
import type { Task, Note } from './types';

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
