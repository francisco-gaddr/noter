import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Task } from '@repo/shared';
import Constants, { ExecutionEnvironment } from 'expo-constants';

const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

const STORAGE_KEY = 'taskReminderMap';
const taskReminderLocks = new Map<string, Promise<void>>();

const readMap = async (): Promise<Record<string, string[]>> => {
  if (isExpoGo) return {};
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || !parsed) return {};
    const out: Record<string, string[]> = {};
    Object.entries(parsed as Record<string, unknown>).forEach(([taskId, value]) => {
      if (Array.isArray(value)) {
        out[taskId] = value.filter((v): v is string => typeof v === 'string');
      } else if (typeof value === 'string') {
        out[taskId] = [value];
      }
    });
    return out;
  } catch {
    return {};
  }
};

const writeMap = async (map: Record<string, string[]>) => {
  if (isExpoGo) return;
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(map));
};

const getNotificationsModule = () => require('expo-notifications');

const withTaskReminderLock = async (taskId: string, operation: () => Promise<void>) => {
  const previous = taskReminderLocks.get(taskId) || Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(operation)
    .finally(() => {
      if (taskReminderLocks.get(taskId) === next) {
        taskReminderLocks.delete(taskId);
      }
    });
  taskReminderLocks.set(taskId, next);
  return next;
};

export const ensureNotificationPermission = async (): Promise<boolean> => {
  if (isExpoGo) {
    console.log('Notifications are disabled in Expo Go');
    return false;
  }
  const Notifications = getNotificationsModule();

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Default',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  const current = await Notifications.getPermissionsAsync();
  if (current.status === 'granted') return true;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.status === 'granted';
};

export const cancelTaskReminder = async (taskId: string) => {
  await withTaskReminderLock(taskId, async () => {
    if (isExpoGo) return;
    const Notifications = getNotificationsModule();
    const map = await readMap();
    const existing = Array.isArray(map[taskId]) ? map[taskId] : [];
    for (const notificationId of existing) {
      try {
        await Notifications.cancelScheduledNotificationAsync(notificationId);
      } catch {
      }
    }
    if (existing.length > 0) {
      delete map[taskId];
      await writeMap(map);
    }
  });
};

export const scheduleTaskReminder = async (task: Task) => {
  await withTaskReminderLock(task._id, async () => {
    if (isExpoGo) return;
    const Notifications = getNotificationsModule();

    if (!task.reminderEnabled || task.completed || !task.dueDate) {
      const map = await readMap();
      const existing = Array.isArray(map[task._id]) ? map[task._id] : [];
      for (const notificationId of existing) {
        try {
          await Notifications.cancelScheduledNotificationAsync(notificationId);
        } catch {
        }
      }
      if (existing.length > 0) {
        delete map[task._id];
        await writeMap(map);
      }
      return;
    }

    const due = new Date(task.dueDate);
    if (isNaN(due.getTime())) {
      const map = await readMap();
      const existing = Array.isArray(map[task._id]) ? map[task._id] : [];
      for (const notificationId of existing) {
        try {
          await Notifications.cancelScheduledNotificationAsync(notificationId);
        } catch {
        }
      }
      if (existing.length > 0) {
        delete map[task._id];
        await writeMap(map);
      }
      return;
    }

    const offsets = Array.isArray(task.reminderOffsetMinutes)
      ? Array.from(new Set(task.reminderOffsetMinutes.filter((v): v is number => typeof v === 'number' && v >= 0)))
      : [0];
    const normalizedOffsets = offsets.length > 0 ? offsets : [0];
    const triggerPairs = normalizedOffsets
      .map((offset) => ({ offset, triggerAt: new Date(due.getTime() - offset * 60000) }))
      .filter(({ triggerAt }) => triggerAt.getTime() > Date.now())
      .sort((a, b) => b.offset - a.offset);

    const map = await readMap();
    const existing = Array.isArray(map[task._id]) ? map[task._id] : [];
    for (const notificationId of existing) {
      try {
        await Notifications.cancelScheduledNotificationAsync(notificationId);
      } catch {
      }
    }

    if (triggerPairs.length === 0) {
      if (existing.length > 0) {
        delete map[task._id];
        await writeMap(map);
      }
      return;
    }

    const granted = await ensureNotificationPermission();
    if (!granted) {
      delete map[task._id];
      await writeMap(map);
      return;
    }

    const ids: string[] = [];
    for (const { offset, triggerAt } of triggerPairs) {
      const id = await Notifications.scheduleNotificationAsync({
        content: {
          title: task.title || 'Påminnelse',
          body: offset > 0 ? `${offset} minuter innan förfallotid` : 'Vid förfallotid',
          data: { taskId: task._id }
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: triggerAt }
      });
      ids.push(id);
    }
    map[task._id] = ids;
    await writeMap(map);
  });
};

export const cancelAllTaskReminders = async () => {
  if (isExpoGo) return;
  const Notifications = getNotificationsModule();
  const map = await readMap();
  const ids = Object.values(map).flat();
  for (const id of ids) {
    try {
      await Notifications.cancelScheduledNotificationAsync(id);
    } catch {
    }
  }
  await writeMap({});
};

export const syncAllTaskReminders = async (tasks: Task[], notificationsEnabled: boolean) => {
  if (isExpoGo) return;
  if (!notificationsEnabled) {
    await cancelAllTaskReminders();
    return;
  }

  const activeTaskIds = new Set(tasks.map((task) => task._id));
  const map = await readMap();
  const staleTaskIds = Object.keys(map).filter((taskId) => !activeTaskIds.has(taskId));
  for (const taskId of staleTaskIds) {
    await cancelTaskReminder(taskId);
  }

  for (const task of tasks) {
    await scheduleTaskReminder(task);
  }
};
