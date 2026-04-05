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

import { scheduleTaskReminder } from '../services/notifications';
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
      .mockResolvedValueOnce('id-30')
      .mockResolvedValueOnce('id-0')
      .mockResolvedValueOnce('id-10');

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
      .mockResolvedValueOnce('id-10')
      .mockResolvedValueOnce('id-0');

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
});
