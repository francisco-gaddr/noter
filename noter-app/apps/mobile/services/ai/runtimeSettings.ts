import AsyncStorage from '@react-native-async-storage/async-storage';

const AI_BACKGROUND_WORK_KEY = 'ai_background_work_enabled_global';

let cachedBackgroundWorkEnabled: boolean | null = null;

export const isAiBackgroundWorkEnabled = async () => {
  if (cachedBackgroundWorkEnabled !== null) return cachedBackgroundWorkEnabled;
  const saved = await AsyncStorage.getItem(AI_BACKGROUND_WORK_KEY);
  cachedBackgroundWorkEnabled = saved === 'true';
  return cachedBackgroundWorkEnabled;
};

export const setAiBackgroundWorkEnabled = async (enabled: boolean) => {
  cachedBackgroundWorkEnabled = enabled;
  await AsyncStorage.setItem(AI_BACKGROUND_WORK_KEY, enabled ? 'true' : 'false');
};

export const resetAiRuntimeSettingsCache = () => {
  cachedBackgroundWorkEnabled = null;
};
