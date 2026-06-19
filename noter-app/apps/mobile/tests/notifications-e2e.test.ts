const mockScheduleNotificationAsync = jest.fn();
const mockCancelScheduledNotificationAsync = jest.fn();

jest.mock('expo-constants', () => ({
  executionEnvironment: 'standalone',
  ExecutionEnvironment: {
    StoreClient: 'storeClient',
  },
}));

jest.mock('expo-notifications', () => ({
  AndroidImportance: { DEFAULT: 3 },
  SchedulableTriggerInputTypes: { DATE: 'date' },
  setNotificationChannelAsync: jest.fn(),
  getPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  requestPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  scheduleNotificationAsync: (...args: any[]) => mockScheduleNotificationAsync(...args),
  cancelScheduledNotificationAsync: (...args: any[]) => mockCancelScheduledNotificationAsync(...args),
  getAllScheduledNotificationsAsync: jest.fn().mockResolvedValue([]),
}));

import { scheduleTaskReminder, cancelAllTaskReminders } from '../services/notifications';
import { Task } from '@repo/shared';

describe('task notifications e2e', () => {
  beforeEach(() => {
    mockScheduleNotificationAsync.mockReset();
    mockCancelScheduledNotificationAsync.mockReset();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-06-01T10:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('reschedules when reminder settings change', async () => {
    mockScheduleNotificationAsync
      .mockResolvedValueOnce('id-0')
      .mockResolvedValueOnce('id-10')
      .mockResolvedValueOnce('id-30');

    const task: Task = {
      _id: 'task-3',
      userId: 'user-1',
      title: 'Test task 3',
      description: '',
      dueDate: new Date('2026-06-01T12:00:00Z').toISOString(),
      completed: false,
      priority: 'medium',
      reminderEnabled: true,
      reminderOffsetMinutes: [0, 30],
      createdAt: new Date('2026-06-01T09:00:00Z').toISOString(),
      updatedAt: new Date('2026-06-01T09:00:00Z').toISOString(),
    };

    await scheduleTaskReminder(task);
    await scheduleTaskReminder({ ...task, reminderOffsetMinutes: [10] });

    expect(mockScheduleNotificationAsync).toHaveBeenCalledTimes(3);
    expect(mockCancelScheduledNotificationAsync).toHaveBeenCalled();
  });

  it('stops reminders when task is marked as completed', async () => {
    mockScheduleNotificationAsync
      .mockResolvedValueOnce('id-0')
      .mockResolvedValueOnce('id-10');

    const task: Task = {
      _id: 'task-4',
      userId: 'user-1',
      title: 'Complete me',
      description: '',
      dueDate: new Date('2026-06-01T12:00:00Z').toISOString(),
      completed: false,
      priority: 'medium',
      reminderEnabled: true,
      reminderOffsetMinutes: [0, 10],
      createdAt: new Date('2026-06-01T09:00:00Z').toISOString(),
      updatedAt: new Date('2026-06-01T09:00:00Z').toISOString(),
    };

    await scheduleTaskReminder(task);
    await scheduleTaskReminder({ ...task, completed: true });

    expect(mockScheduleNotificationAsync).toHaveBeenCalledTimes(2);
    expect(mockCancelScheduledNotificationAsync).toHaveBeenCalledTimes(2);
  });

  it('cancelAllTaskReminders cancels EVERY scheduled id (flattened), not the per-task arrays', async () => {
    // task A → 2 ids, task B → 1 id; the id-map stores Record<string, string[]>.
    mockScheduleNotificationAsync
      .mockResolvedValueOnce('a-0').mockResolvedValueOnce('a-30')
      .mockResolvedValueOnce('b-0');
    const mk = (id: string, offsets: number[]): Task => ({
      _id: id, userId: 'u', title: id, description: '',
      dueDate: new Date('2026-06-01T12:00:00Z').toISOString(), completed: false, priority: 'medium',
      reminderEnabled: true, reminderOffsetMinutes: offsets,
      createdAt: '2026-06-01T09:00:00Z', updatedAt: '2026-06-01T09:00:00Z',
    });
    await scheduleTaskReminder(mk('A', [0, 30]));
    await scheduleTaskReminder(mk('B', [0]));

    mockCancelScheduledNotificationAsync.mockClear();
    await cancelAllTaskReminders();

    // Regression: the old code passed the per-task ARRAYS to cancelScheduledNotificationAsync,
    // which silently failed and orphaned every reminder. Now each real id is cancelled as a STRING.
    const cancelled = mockCancelScheduledNotificationAsync.mock.calls.map((c) => c[0]);
    expect(cancelled).toEqual(expect.arrayContaining(['a-0', 'a-30', 'b-0']));
    cancelled.forEach((arg) => expect(typeof arg).toBe('string'));
  });
});
