import AsyncStorage from '@react-native-async-storage/async-storage';
import { defaultFeatureSettings, parseFeatureSettings, serializeFeatureSettings, type FeatureSettings } from '@repo/shared';
import { resolveAiSettingsScope } from './ai/settingsScope';

// Creative-feature toggles + per-feature AI config, scoped per user (parity with the AI settings).
// Plain AsyncStorage — preferences, not secrets (API keys live under their own SecureStore keys).
const KEY = 'feature_settings_v1';
const scopedKey = async () => `${KEY}_${await resolveAiSettingsScope()}`;

let cache: FeatureSettings | null = null;

export const getFeatureSettings = async (): Promise<FeatureSettings> => {
  try {
    const s = parseFeatureSettings(await AsyncStorage.getItem(await scopedKey()));
    cache = s;
    return s;
  } catch {
    return defaultFeatureSettings();
  }
};

/** Synchronous best-effort read of the last-loaded settings (for render paths that can't await). */
export const getFeatureSettingsCached = (): FeatureSettings => cache || defaultFeatureSettings();

export const saveFeatureSettings = async (s: FeatureSettings): Promise<void> => {
  cache = s;
  try { await AsyncStorage.setItem(await scopedKey(), serializeFeatureSettings(s)); } catch { /* best-effort */ }
};
