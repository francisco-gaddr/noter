import { buildCalendarProjection, generateIcs } from './calendar';
import type { Task } from './types';

const task = (over: Partial<Task>): Task => ({
  _id: 't1', userId: 'u1', title: 'Task', completed: false,
  createdAt: '', updatedAt: '', ...over,
} as Task);

describe('buildCalendarProjection', () => {
  it('includes only tasks with a valid due date', () => {
    const items = buildCalendarProjection([
      task({ _id: 'a', title: 'Has due', dueDate: '2026-07-01T00:00:00.000Z' }),
      task({ _id: 'b', title: 'No due', dueDate: null }),
      task({ _id: 'c', title: 'Bad due', dueDate: 'not-a-date' }),
    ]);
    expect(items.map((i) => i.uid)).toEqual(['a']);
    expect(items[0].title).toBe('Has due');
  });

  it('marks local-midnight due dates as all-day and timed ones as not', () => {
    // Construct via local components so the assertion holds in any runner timezone.
    const items = buildCalendarProjection([
      task({ _id: 'allday', dueDate: new Date(2026, 6, 1, 0, 0, 0).toISOString() }),
      task({ _id: 'timed', dueDate: new Date(2026, 6, 1, 13, 30, 0).toISOString() }),
    ]);
    expect(items.find((i) => i.uid === 'allday')?.allDay).toBe(true);
    expect(items.find((i) => i.uid === 'timed')?.allDay).toBe(false);
  });

  it('skips deleted tasks and carries completed state', () => {
    const items = buildCalendarProjection([
      task({ _id: 'del', dueDate: new Date(2026, 6, 1).toISOString(), deleted: true }),
      task({ _id: 'done', dueDate: new Date(2026, 6, 1).toISOString(), completed: true }),
    ]);
    expect(items.map((i) => i.uid)).toEqual(['done']);
    expect(items[0].completed).toBe(true);
  });
});

describe('buildSafeCalendarProjection — list scope', () => {
  const { buildSafeCalendarProjection } = require('./calendar');
  const t = (over: any) => ({ _id: over._id, userId: 'u', title: over.title || 'T', completed: false, createdAt: '', updatedAt: '', ...over });
  const tasks = [
    t({ _id: 'a', dueDate: new Date(2026, 6, 1).toISOString(), parentNoteId: 'listX' }),
    t({ _id: 'b', dueDate: new Date(2026, 6, 1).toISOString(), parentNoteId: 'listY' }),
    t({ _id: 'c', dueDate: new Date(2026, 6, 1).toISOString() }), // no list
  ];

  it('with no listId includes all dated tasks', () => {
    const items = buildSafeCalendarProjection(tasks, [], [], {});
    expect(items.map((i: any) => i.uid).sort()).toEqual(['a', 'b', 'c']);
  });

  it('with a listId includes ONLY that list\'s tasks', () => {
    const items = buildSafeCalendarProjection(tasks, [], [], { listId: 'listX' });
    expect(items.map((i: any) => i.uid)).toEqual(['a']);
  });

  it("treats 'all' the same as no list", () => {
    const items = buildSafeCalendarProjection(tasks, [], [], { listId: 'all' });
    expect(items.length).toBe(3);
  });

  it('with listIds includes the UNION of those lists only', () => {
    const items = buildSafeCalendarProjection(tasks, [], [], { listIds: ['listX', 'listY'] });
    expect(items.map((i: any) => i.uid).sort()).toEqual(['a', 'b']); // not 'c' (no list)
  });

  it('with an empty listIds set falls back to all tasks', () => {
    const items = buildSafeCalendarProjection(tasks, [], [], { listIds: [] });
    expect(items.length).toBe(3);
  });
});

describe('generateIcs', () => {
  const now = new Date('2026-06-14T10:00:00.000Z');

  it('produces a valid VCALENDAR with CRLF and one VEVENT per item', () => {
    const ics = generateIcs(
      [{ uid: 'a', title: 'Möte, viktigt', start: '2026-07-01T13:30:00.000Z', allDay: false, completed: false }],
      { now },
    );
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true);
    expect(ics).toContain('\r\n');
    expect(ics).toContain('UID:a@noter');
    expect(ics).toContain('DTSTART:20260701T133000Z');
    // commas in SUMMARY are escaped per RFC5545
    expect(ics).toContain('SUMMARY:Möte\\, viktigt');
    expect(ics).toContain('STATUS:CONFIRMED');
  });

  it('emits all-day events as VALUE=DATE and marks completed', () => {
    const ics = generateIcs(
      [{ uid: 'b', title: 'Deadline', start: '2026-07-02T00:00:00.000Z', allDay: true, completed: true }],
      { now },
    );
    expect(ics).toContain('DTSTART;VALUE=DATE:20260702');
    expect(ics).toContain('STATUS:COMPLETED');
    expect(ics).toContain('SUMMARY:✓ Deadline');
  });

  it('skips items with an unparseable start', () => {
    const ics = generateIcs([{ uid: 'x', title: 'Bad', start: 'nope', allDay: true, completed: false }], { now });
    expect(ics).not.toContain('UID:x@noter');
  });
});
