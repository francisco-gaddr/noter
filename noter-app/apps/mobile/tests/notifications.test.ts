const mockScheduleNotificationAsync = jest.fn();
const mockCancelScheduledNotificationAsync = jest.fn();
const mockGetAllScheduledNotificationsAsync = jest.fn();

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
  getAllScheduledNotificationsAsync: (...args: any[]) => mockGetAllScheduledNotificationsAsync(...args),
}));

import { scheduleTaskReminder, cancelTaskReminder, cancelAllTaskReminders, syncAllTaskReminders } from '../services/notifications';
import { Task } from '@repo/shared';

describe('task notifications', () => {
  beforeEach(async () => {
    mockScheduleNotificationAsync.mockReset();
    mockCancelScheduledNotificationAsync.mockReset();
    mockGetAllScheduledNotificationsAsync.mockReset().mockResolvedValue([]);
    const asyncStorageModule = require('@react-native-async-storage/async-storage');
    const asyncStorage = asyncStorageModule.default || asyncStorageModule;
    if (typeof asyncStorage.clear === 'function') {
      await asyncStorage.clear();
    }
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-06-01T10:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('schemalägger alla framtida påminnelser för valda offsets på exakt rätt klockslag', async () => {
    mockScheduleNotificationAsync
      .mockResolvedValueOnce('id-30')
      .mockResolvedValueOnce('id-10')
      .mockResolvedValueOnce('id-0');

    const task: Task = {
      _id: 'task-1',
      userId: 'user-1',
      title: 'Test task',
      description: '',
      dueDate: new Date('2026-06-01T10:31:00Z').toISOString(),
      completed: false,
      priority: 'medium',
      reminderEnabled: true,
      reminderOffsetMinutes: [0, 10, 30],
      createdAt: new Date('2026-06-01T09:00:00Z').toISOString(),
      updatedAt: new Date('2026-06-01T09:00:00Z').toISOString(),
    };

    await scheduleTaskReminder(task);

    expect(mockScheduleNotificationAsync).toHaveBeenCalledTimes(3);
    const firstCall = mockScheduleNotificationAsync.mock.calls[0]?.[0];
    const secondCall = mockScheduleNotificationAsync.mock.calls[1]?.[0];
    const thirdCall = mockScheduleNotificationAsync.mock.calls[2]?.[0];
    expect(firstCall.content.title).toBe(task.title);
    expect(firstCall.content.body).toContain('30 minuter');
    expect(firstCall.trigger.date.toISOString()).toBe('2026-06-01T10:01:00.000Z');
    expect(secondCall.content.body).toContain('10 minuter');
    expect(secondCall.trigger.date.toISOString()).toBe('2026-06-01T10:21:00.000Z');
    expect(thirdCall.content.body).toContain('Vid förfallotid');
    expect(thirdCall.trigger.date.toISOString()).toBe('2026-06-01T10:31:00.000Z');
  });

  it('cancels all scheduled reminders for a task', async () => {
    mockScheduleNotificationAsync.mockResolvedValueOnce('id-10');

    const task: Task = {
      _id: 'task-2',
      userId: 'user-1',
      title: 'Test task 2',
      description: '',
      dueDate: new Date('2026-06-01T11:00:00Z').toISOString(),
      completed: false,
      priority: 'medium',
      reminderEnabled: true,
      reminderOffsetMinutes: [0, 10],
      createdAt: new Date('2026-06-01T09:00:00Z').toISOString(),
      updatedAt: new Date('2026-06-01T09:00:00Z').toISOString(),
    };

    await scheduleTaskReminder(task);
    await cancelTaskReminder(task._id);

    expect(mockCancelScheduledNotificationAsync).toHaveBeenCalledTimes(1);
  });

  it('does not schedule reminders for already completed tasks', async () => {
    const task: Task = {
      _id: 'task-3',
      userId: 'user-1',
      title: 'Already done',
      description: '',
      dueDate: new Date('2026-06-01T12:00:00Z').toISOString(),
      completed: true,
      priority: 'medium',
      reminderEnabled: true,
      reminderOffsetMinutes: [0, 10],
      createdAt: new Date('2026-06-01T09:00:00Z').toISOString(),
      updatedAt: new Date('2026-06-01T09:00:00Z').toISOString(),
    };

    await scheduleTaskReminder(task);

    expect(mockScheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('cancels orphaned scheduled reminders for completed tasks', async () => {
    mockGetAllScheduledNotificationsAsync.mockResolvedValue([
      { identifier: 'orphan-1', content: { data: { taskId: 'task-3b' } } },
      { identifier: 'orphan-2', content: { data: { taskId: 'task-3b' } } },
    ]);

    const task: Task = {
      _id: 'task-3b',
      userId: 'user-1',
      title: 'Already done with orphan reminders',
      description: '',
      dueDate: new Date('2026-06-01T12:00:00Z').toISOString(),
      completed: true,
      priority: 'medium',
      reminderEnabled: true,
      reminderOffsetMinutes: [0, 10],
      createdAt: new Date('2026-06-01T09:00:00Z').toISOString(),
      updatedAt: new Date('2026-06-01T09:00:00Z').toISOString(),
    };

    await scheduleTaskReminder(task);

    expect(mockScheduleNotificationAsync).not.toHaveBeenCalled();
    expect(mockCancelScheduledNotificationAsync).toHaveBeenCalledWith('orphan-1');
    expect(mockCancelScheduledNotificationAsync).toHaveBeenCalledWith('orphan-2');
  });

  it('replaces existing reminders when the same task is rescheduled concurrently', async () => {
    mockScheduleNotificationAsync
      .mockResolvedValueOnce('first-10')
      .mockResolvedValueOnce('first-0')
      .mockResolvedValueOnce('second-10')
      .mockResolvedValueOnce('second-0');

    const task: Task = {
      _id: 'task-4',
      userId: 'user-1',
      title: 'Concurrent task',
      description: '',
      dueDate: new Date('2026-06-01T12:30:00Z').toISOString(),
      completed: false,
      priority: 'medium',
      reminderEnabled: true,
      reminderOffsetMinutes: [0, 10],
      createdAt: new Date('2026-06-01T09:00:00Z').toISOString(),
      updatedAt: new Date('2026-06-01T09:00:00Z').toISOString(),
    };

    await Promise.all([scheduleTaskReminder(task), scheduleTaskReminder(task)]);

    expect(mockScheduleNotificationAsync).toHaveBeenCalledTimes(4);
    expect(mockCancelScheduledNotificationAsync).toHaveBeenCalledWith('first-10');
    expect(mockCancelScheduledNotificationAsync).toHaveBeenCalledWith('first-0');
  });

  it('cancels every stored reminder when notifications are disabled globally', async () => {
    mockScheduleNotificationAsync
      .mockResolvedValueOnce('id-a1')
      .mockResolvedValueOnce('id-b1');

    const first: Task = {
      _id: 'task-5',
      userId: 'user-1',
      title: 'First task',
      description: '',
      dueDate: new Date('2026-06-01T13:00:00Z').toISOString(),
      completed: false,
      priority: 'medium',
      reminderEnabled: true,
      reminderOffsetMinutes: [0, 10],
      createdAt: new Date('2026-06-01T09:00:00Z').toISOString(),
      updatedAt: new Date('2026-06-01T09:00:00Z').toISOString(),
    };
    const second: Task = {
      ...first,
      _id: 'task-6',
      title: 'Second task',
      dueDate: new Date('2026-06-01T14:00:00Z').toISOString(),
    };

    await scheduleTaskReminder(first);
    await scheduleTaskReminder(second);
    await cancelAllTaskReminders();

    expect(mockCancelScheduledNotificationAsync).toHaveBeenCalledWith('id-a1');
    expect(mockCancelScheduledNotificationAsync).toHaveBeenCalledWith('id-b1');
  });

  it('does not cancel unrelated reminders during partial sync', async () => {
    mockScheduleNotificationAsync
      .mockResolvedValueOnce('id-a')
      .mockResolvedValueOnce('id-b');

    const first: Task = {
      _id: 'task-7',
      userId: 'user-1',
      title: 'Scoped first task',
      description: '',
      dueDate: new Date('2026-06-01T13:00:00Z').toISOString(),
      completed: false,
      priority: 'medium',
      reminderEnabled: true,
      reminderOffsetMinutes: [0, 10],
      createdAt: new Date('2026-06-01T09:00:00Z').toISOString(),
      updatedAt: new Date('2026-06-01T09:00:00Z').toISOString(),
    };
    const second: Task = {
      ...first,
      _id: 'task-8',
      title: 'Scoped second task',
      dueDate: new Date('2026-06-01T14:00:00Z').toISOString(),
    };

    await scheduleTaskReminder(first);
    await scheduleTaskReminder(second);
    mockCancelScheduledNotificationAsync.mockClear();

    await syncAllTaskReminders([first], true, { cancelMissing: false });

    expect(mockCancelScheduledNotificationAsync).not.toHaveBeenCalledWith('id-b');
  });

  it('skips rescheduling unchanged reminders during full sync', async () => {
    mockScheduleNotificationAsync.mockResolvedValueOnce('id-stable');

    const task: Task = {
      _id: 'task-9',
      userId: 'user-1',
      title: 'Stable reminder task',
      description: '',
      dueDate: new Date('2026-06-01T15:00:00Z').toISOString(),
      completed: false,
      priority: 'medium',
      reminderEnabled: true,
      reminderOffsetMinutes: [10],
      createdAt: new Date('2026-06-01T09:00:00Z').toISOString(),
      updatedAt: new Date('2026-06-01T09:00:00Z').toISOString(),
    };

    await syncAllTaskReminders([task], true, { cancelMissing: true });
    await syncAllTaskReminders([task], true, { cancelMissing: true });

    expect(mockScheduleNotificationAsync).toHaveBeenCalledTimes(1);
  });
});
