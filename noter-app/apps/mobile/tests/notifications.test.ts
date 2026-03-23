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
}));

import { scheduleTaskReminder, cancelTaskReminder } from '../services/notifications';
import { Task } from '@repo/shared';

describe('task notifications', () => {
  beforeEach(() => {
    mockScheduleNotificationAsync.mockReset();
    mockCancelScheduledNotificationAsync.mockReset();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-06-01T10:00:00Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('schedules multiple reminders when offsets are selected', async () => {
    mockScheduleNotificationAsync
      .mockResolvedValueOnce('id-0')
      .mockResolvedValueOnce('id-10')
      .mockResolvedValueOnce('id-30');

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
    expect(firstCall.content.title).toBe(task.title);
    expect(typeof firstCall.content.body).toBe('string');
    expect(firstCall.content.body.length).toBeGreaterThan(0);
  });

  it('cancels all scheduled reminders for a task', async () => {
    mockScheduleNotificationAsync
      .mockResolvedValueOnce('id-0')
      .mockResolvedValueOnce('id-10');

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

    expect(mockCancelScheduledNotificationAsync).toHaveBeenCalledTimes(2);
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
});
