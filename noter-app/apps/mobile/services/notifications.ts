import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Task } from '@repo/shared';
import Constants, { ExecutionEnvironment } from 'expo-constants';

const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

const STORAGE_KEY = 'taskReminderMap';

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
  // Bulletproof against duplicates: also sweep EVERY scheduled notification for this
  // task by data.taskId. The id-map can miss orphans (scheduled before the map tracked
  // them, or by an older build), and those orphans are exactly why several push notices
  // fired for one due task. This guarantees at most the freshly-scheduled set remains.
  try {
    const all = await Notifications.getAllScheduledNotificationsAsync();
    for (const n of all || []) {
      if (n?.content?.data?.taskId === taskId) {
        try { await Notifications.cancelScheduledNotificationAsync(n.identifier); } catch { /* ignore */ }
      }
    }
  } catch { /* ignore — best effort */ }
  if (map[taskId]) {
    delete map[taskId];
    await writeMap(map);
  }
};

export const scheduleTaskReminder = async (task: Task) => {
  if (isExpoGo) return;
  const Notifications = getNotificationsModule();
  
  if (!task.reminderEnabled) {
    await cancelTaskReminder(task._id);
    return;
  }
  if (task.completed) {
    await cancelTaskReminder(task._id);
    return;
  }
  if (!task.dueDate) {
    await cancelTaskReminder(task._id);
    return;
  }
  const due = new Date(task.dueDate);
  if (isNaN(due.getTime())) {
    await cancelTaskReminder(task._id);
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
  if (triggerPairs.length === 0) {
    await cancelTaskReminder(task._id);
    return;
  }
  const granted = await ensureNotificationPermission();
  if (!granted) return;
  await cancelTaskReminder(task._id);
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
  const map = await readMap();
  map[task._id] = ids;
  await writeMap(map);
};

export const cancelAllTaskReminders = async () => {
  if (isExpoGo) return;
  const Notifications = getNotificationsModule();
  const map = await readMap();
  const ids = Object.values(map);
  for (const id of ids) {
    try {
      await Notifications.cancelScheduledNotificationAsync(id);
    } catch {
    }
  }
  await writeMap({});
};
