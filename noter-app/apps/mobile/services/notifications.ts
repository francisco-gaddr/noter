import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Task } from '@repo/shared';
import Constants, { ExecutionEnvironment } from 'expo-constants';

const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

const STORAGE_KEY = 'taskReminderMap';

const readMap = async (): Promise<Record<string, string>> => {
  if (isExpoGo) return {};
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed ? parsed : {};
  } catch {
    return {};
  }
};

const writeMap = async (map: Record<string, string>) => {
  if (isExpoGo) return;
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(map));
};

export const ensureNotificationPermission = async (): Promise<boolean> => {
  if (isExpoGo) {
    console.log('Notifications are disabled in Expo Go');
    return false;
  }

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
  const map = await readMap();
  const existing = map[taskId];
  if (existing) {
    try {
      await Notifications.cancelScheduledNotificationAsync(existing);
    } catch {
    }
    delete map[taskId];
    await writeMap(map);
  }
};

export const scheduleTaskReminder = async (task: Task) => {
  if (isExpoGo) return;
  
  if (!task.reminderEnabled) {
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
  const offset = task.reminderOffsetMinutes === 10 ? 10 : 0;
  const triggerAt = new Date(due.getTime() - offset * 60000);
  if (triggerAt.getTime() <= Date.now()) {
    await cancelTaskReminder(task._id);
    return;
  }
  const granted = await ensureNotificationPermission();
  if (!granted) return;
  await cancelTaskReminder(task._id);
  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: task.title || 'Påminnelse',
      body: offset === 10 ? '10 minuter innan förfallotid' : 'Vid förfallotid',
      data: { taskId: task._id }
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: triggerAt }
  });
  const map = await readMap();
  map[task._id] = id;
  await writeMap(map);
};

export const cancelAllTaskReminders = async () => {
  if (isExpoGo) return;
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
