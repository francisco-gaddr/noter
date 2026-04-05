import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Task } from '@repo/shared';
import Constants, { ExecutionEnvironment } from 'expo-constants';

const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

const STORAGE_KEY = 'taskReminderMap';
const taskReminderLocks = new Map<string, Promise<void>>();
const taskReminderSignatureCache = new Map<string, string>();

const isTaskReminderEligible = (task: Task) => Boolean(
  task.reminderEnabled &&
  !task.completed &&
  task.dueDate
);

const getTaskReminderSignature = (task: Task) => JSON.stringify({
  title: task.title || '',
  completed: !!task.completed,
  dueDate: task.dueDate || null,
  reminderEnabled: !!task.reminderEnabled,
  reminderOffsetMinutes: Array.isArray(task.reminderOffsetMinutes) ? [...task.reminderOffsetMinutes].sort((a, b) => a - b) : [0],
});

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

const getScheduledNotificationIdsForTask = async (taskId: string): Promise<string[]> => {
  if (isExpoGo) return [];
  const Notifications = getNotificationsModule();
  if (typeof Notifications.getAllScheduledNotificationsAsync !== 'function') {
    return [];
  }
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    if (!Array.isArray(scheduled)) return [];
    return scheduled
      .filter((entry: any) => String(entry?.content?.data?.taskId || '') === String(taskId))
      .map((entry: any) => String(entry?.identifier || ''))
      .filter(Boolean);
  } catch {
    return [];
  }
};

const cancelStoredNotificationIds = async (taskId: string) => {
  if (isExpoGo) return;
  const Notifications = getNotificationsModule();
  const map = await readMap();
  const mappedIds = Array.isArray(map[taskId]) ? map[taskId] : [];
  const liveIds = await getScheduledNotificationIdsForTask(taskId);
  const existing = Array.from(new Set([...mappedIds, ...liveIds]));
  for (const notificationId of existing) {
    try {
      await Notifications.cancelScheduledNotificationAsync(notificationId);
    } catch {
    }
  }
  if (existing.length > 0 || mappedIds.length > 0) {
    delete map[taskId];
    await writeMap(map);
  }
  taskReminderSignatureCache.delete(taskId);
};

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
    await cancelStoredNotificationIds(taskId);
  });
};

export const scheduleTaskReminder = async (task: Task) => {
  await withTaskReminderLock(task._id, async () => {
    if (isExpoGo) return;
    const Notifications = getNotificationsModule();

    if (!isTaskReminderEligible(task)) {
      await cancelStoredNotificationIds(task._id);
      return;
    }

    const due = new Date(task.dueDate as string);
    if (isNaN(due.getTime())) {
      await cancelStoredNotificationIds(task._id);
      return;
    }

    const offsets = Array.isArray(task.reminderOffsetMinutes)
      ? Array.from(new Set(task.reminderOffsetMinutes.filter((v): v is number => typeof v === 'number' && v >= 0)))
      : [0];
    const normalizedOffsets = offsets.length > 0 ? offsets : [0];
    const triggerPairs = normalizedOffsets
      .map((offset) => ({ offset, triggerAt: new Date(due.getTime() - offset * 60000) }))
      .filter(({ triggerAt }) => triggerAt.getTime() > Date.now())
      .sort((a, b) => a.triggerAt.getTime() - b.triggerAt.getTime());

    await cancelStoredNotificationIds(task._id);
    const map = await readMap();

    if (triggerPairs.length === 0) {
      delete map[task._id];
      await writeMap(map);
      taskReminderSignatureCache.delete(task._id);
      return;
    }

    const granted = await ensureNotificationPermission();
    if (!granted) {
      delete map[task._id];
      await writeMap(map);
      return;
    }

    const ids: string[] = [];
    try {
      for (const triggerPair of triggerPairs) {
        const id = await Notifications.scheduleNotificationAsync({
          content: {
            title: task.title || 'Påminnelse',
            body: triggerPair.offset > 0 ? `${triggerPair.offset} minuter innan förfallotid` : 'Vid förfallotid',
            data: { taskId: task._id, reminderOffsetMinutes: triggerPair.offset }
          },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: triggerPair.triggerAt }
        });
        ids.push(id);
      }
    } catch (error) {
      for (const notificationId of ids) {
        try {
          await Notifications.cancelScheduledNotificationAsync(notificationId);
        } catch {
        }
      }
      throw error;
    }
    map[task._id] = ids;
    await writeMap(map);
    taskReminderSignatureCache.set(task._id, getTaskReminderSignature(task));
  });
};

export const cancelAllTaskReminders = async () => {
  if (isExpoGo) return;
  const Notifications = getNotificationsModule();
  const map = await readMap();
  const liveEntries = typeof Notifications.getAllScheduledNotificationsAsync === 'function'
    ? await Notifications.getAllScheduledNotificationsAsync().catch(() => [])
    : [];
  const allIds = Array.from(new Set([
    ...Object.values(map).flat(),
    ...((Array.isArray(liveEntries) ? liveEntries : []).map((entry: any) => String(entry?.identifier || '')).filter(Boolean))
  ]));
  for (const id of allIds) {
    try {
      await Notifications.cancelScheduledNotificationAsync(id);
    } catch {
    }
  }
  await writeMap({});
  taskReminderSignatureCache.clear();
};

export const syncAllTaskReminders = async (
  tasks: Task[],
  notificationsEnabled: boolean,
  options?: { cancelMissing?: boolean }
) => {
  if (isExpoGo) return;
  if (!notificationsEnabled) {
    await cancelAllTaskReminders();
    return;
  }

  if (options?.cancelMissing) {
    const activeTaskIds = new Set(tasks.map((task) => task._id));
    const map = await readMap();
    const staleTaskIds = Object.keys(map).filter((taskId) => !activeTaskIds.has(taskId));
    for (const taskId of staleTaskIds) {
      await cancelTaskReminder(taskId);
    }
  }

  for (const task of tasks) {
    const nextSignature = getTaskReminderSignature(task);
    if (taskReminderSignatureCache.get(task._id) === nextSignature) {
      continue;
    }
    await scheduleTaskReminder(task);
  }
};
