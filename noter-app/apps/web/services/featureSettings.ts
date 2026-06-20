import { defaultFeatureSettings, parseFeatureSettings, serializeFeatureSettings, type FeatureSettings } from '@repo/shared';

// Creative-feature toggles + per-feature AI config (see @repo/shared/featureSettings). Plain
// localStorage — these are preferences, not secrets (API keys live under their own encrypted keys).
const KEY = 'feature_settings_v1';

export const getFeatureSettings = (): FeatureSettings => {
  if (typeof localStorage === 'undefined') return defaultFeatureSettings();
  return parseFeatureSettings(localStorage.getItem(KEY));
};

export const saveFeatureSettings = (s: FeatureSettings): void => {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, serializeFeatureSettings(s));
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('noter:feature-settings-changed'));
  } catch { /* best-effort */ }
};
