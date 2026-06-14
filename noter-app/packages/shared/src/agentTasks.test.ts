import { isAiTask, parseAiDelegation, serializeAiDelegation, selectDueAiTasks } from './agentTasks';
import type { Task } from './types';

const task = (over: Partial<Task>): Task => ({
  _id: over._id ?? 't1',
  userId: 'u',
  title: 't',
  completed: false,
  createdAt: '',
  updatedAt: '',
  ...over,
});

describe('agentTasks delegation parsing', () => {
  it('isAiTask only true for ai assignee', () => {
    expect(isAiTask({ assignee: 'ai' })).toBe(true);
    expect(isAiTask({ assignee: 'user' })).toBe(false);
    expect(isAiTask(null)).toBe(false);
    expect(isAiTask(undefined)).toBe(false);
  });

  it('parses a JSON string and defaults toolUse=true, status=idle', () => {
    const d = parseAiDelegation('{"assignee":"ai","source":"hermes","model":"qwen2.5:3b-instruct"}');
    expect(d).toMatchObject({ assignee: 'ai', source: 'hermes', model: 'qwen2.5:3b-instruct', toolUse: true, status: 'idle', runCount: 0 });
  });

  it('round-trips serialize/parse', () => {
    const d = { assignee: 'ai' as const, source: 'api' as const, provider: 'groq', model: 'x', localOnly: true, toolUse: false };
    const parsed = parseAiDelegation(serializeAiDelegation(d));
    expect(parsed).toMatchObject(d);
  });

  it('parses backend-execution + notify fields', () => {
    const d = parseAiDelegation('{"assignee":"ai","source":"hermes","baseUrl":"http://pi:11434","runOnBackend":true,"notify":{"onStart":true}}');
    expect(d).toMatchObject({ assignee: 'ai', baseUrl: 'http://pi:11434', runOnBackend: true });
    expect(d!.notify).toEqual({ onStart: true, onFinish: true }); // onFinish defaults true
  });

  it('returns null for empty/invalid', () => {
    expect(parseAiDelegation('')).toBeNull();
    expect(parseAiDelegation('null')).toBeNull();
    expect(parseAiDelegation('{bad json')).toBeNull();
    expect(parseAiDelegation(undefined)).toBeNull();
    expect(parseAiDelegation([1, 2])).toBeNull();
  });
});

describe('selectDueAiTasks', () => {
  const now = new Date('2026-06-14T11:00:00.000Z');

  it('selects an ai task whose dueDate has passed', () => {
    const t = task({ aiAgent: { assignee: 'ai', status: 'idle' }, dueDate: '2026-06-14T10:59:00.000Z' });
    expect(selectDueAiTasks([t], now).map((x) => x._id)).toEqual(['t1']);
  });

  it('ignores user tasks, completed, deleted, running, done, and future', () => {
    const tasks: Task[] = [
      task({ _id: 'user', aiAgent: { assignee: 'user' }, dueDate: '2026-06-14T10:00:00.000Z' }),
      task({ _id: 'completed', completed: true, aiAgent: { assignee: 'ai' }, dueDate: '2026-06-14T10:00:00.000Z' }),
      task({ _id: 'deleted', deleted: true, aiAgent: { assignee: 'ai' }, dueDate: '2026-06-14T10:00:00.000Z' }),
      task({ _id: 'running', aiAgent: { assignee: 'ai', status: 'running' }, dueDate: '2026-06-14T10:00:00.000Z' }),
      task({ _id: 'done', aiAgent: { assignee: 'ai', status: 'done' }, dueDate: '2026-06-14T10:00:00.000Z' }),
      task({ _id: 'future', aiAgent: { assignee: 'ai' }, dueDate: '2026-06-14T12:00:00.000Z' }),
      task({ _id: 'noDue', aiAgent: { assignee: 'ai' } }),
    ];
    expect(selectDueAiTasks(tasks, now)).toEqual([]);
  });

  it('skips a task overdue beyond the grace window', () => {
    const old = task({ aiAgent: { assignee: 'ai' }, dueDate: '2026-06-10T10:00:00.000Z' }); // 4 days old
    expect(selectDueAiTasks([old], now)).toEqual([]);
  });
});
