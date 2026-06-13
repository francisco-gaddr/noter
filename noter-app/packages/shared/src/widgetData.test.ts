import { toWidgetTasks, buildWidgetSnapshot, WIDGET_SNAPSHOT_VERSION, priorityRank } from './widgetData';
import type { Task } from './types';

describe('priorityRank (single source of truth)', () => {
  it('ranks high<medium<low and treats unknown as medium', () => {
    expect(priorityRank('high')).toBe(0);
    expect(priorityRank('medium')).toBe(1);
    expect(priorityRank('low')).toBe(2);
    expect(priorityRank(undefined)).toBe(1);
    expect(priorityRank('weird')).toBe(1);
  });
});

const task = (over: Partial<Task>): Task => ({
  _id: Math.random().toString(36).slice(2),
  userId: 'u',
  title: 'T',
  completed: false,
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
  ...over,
});

describe('toWidgetTasks', () => {
  it('hides completed by default and includes them when asked', () => {
    const tasks = [task({ title: 'A' }), task({ title: 'B', completed: true })];
    expect(toWidgetTasks(tasks).map((t) => t.title)).toEqual(['A']);
    expect(toWidgetTasks(tasks, { includeCompleted: true }).map((t) => t.title).sort()).toEqual(['A', 'B']);
  });

  it('filters by list (parentNoteId)', () => {
    const tasks = [task({ title: 'A', parentNoteId: 'l1' }), task({ title: 'B', parentNoteId: 'l2' })];
    expect(toWidgetTasks(tasks, { listId: 'l1' }).map((t) => t.title)).toEqual(['A']);
  });

  it('drops soft-deleted tasks', () => {
    const tasks = [task({ title: 'A' }), task({ title: 'Z', deleted: true }), task({ title: 'Y', deleted: 'true' })];
    expect(toWidgetTasks(tasks).map((t) => t.title)).toEqual(['A']);
  });

  it('sorts by priority (high→low), then due date', () => {
    const tasks = [
      task({ title: 'low', priority: 'low' }),
      task({ title: 'high', priority: 'high' }),
      task({ title: 'medium', priority: 'medium' }),
    ];
    expect(toWidgetTasks(tasks, { sort: 'priority' }).map((t) => t.title)).toEqual(['high', 'medium', 'low']);
  });

  it('sorts by time with undated tasks last', () => {
    const tasks = [
      task({ title: 'none', dueDate: null }),
      task({ title: 'later', dueDate: '2026-06-20T00:00:00.000Z' }),
      task({ title: 'soon', dueDate: '2026-06-14T00:00:00.000Z' }),
    ];
    expect(toWidgetTasks(tasks, { sort: 'time' }).map((t) => t.title)).toEqual(['soon', 'later', 'none']);
  });

  it('honours the row limit', () => {
    const tasks = [task({ priority: 'high' }), task({ priority: 'medium' }), task({ priority: 'low' })];
    expect(toWidgetTasks(tasks, { limit: 2 })).toHaveLength(2);
  });

  it('defaults a missing priority to medium', () => {
    expect(toWidgetTasks([task({ priority: undefined })])[0].priority).toBe('medium');
  });
});

describe('buildWidgetSnapshot', () => {
  it('produces a versioned snapshot carrying only widget fields', () => {
    const snap = buildWidgetSnapshot(
      [task({ title: 'A', description: 'secret body', priority: 'high' })],
      [{ id: 'l1', name: 'Inbox' }],
      '2026-06-13T10:00:00.000Z',
    );
    expect(snap.version).toBe(WIDGET_SNAPSHOT_VERSION);
    expect(snap.generatedAt).toBe('2026-06-13T10:00:00.000Z');
    expect(snap.lists).toEqual([{ id: 'l1', name: 'Inbox' }]);
    expect(snap.tasks[0]).not.toHaveProperty('description'); // bodies never leave to the widget
    expect(snap.tasks[0].title).toBe('A');
  });
});
