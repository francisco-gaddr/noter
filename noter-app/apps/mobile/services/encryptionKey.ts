import { activateDataKey, clearEncryptionKey, unwrapDataKeyWithPassword } from '@repo/shared';

const STORAGE_KEY = 'local_data_key_v1';
const LEGACY_STORAGE_KEY = 'local_encryption_key_v1';
const KEY_PATTERN = /^[a-f0-9]{64}$/i;

const isValidKey = (key: unknown): key is string => typeof key === 'string' && KEY_PATTERN.test(key);
const secureStoreOptions = {
  keychainAccessible: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY' as any,
};

const readStoredDataKey = async () => {
  const SecureStore = require('expo-secure-store');
  const [current, legacy] = await Promise.all([
    SecureStore.getItemAsync(STORAGE_KEY, secureStoreOptions).catch(() => null),
    SecureStore.getItemAsync(LEGACY_STORAGE_KEY, secureStoreOptions).catch(() => null),
  ]);
  return isValidKey(current) ? current : isValidKey(legacy) ? legacy : '';
};

export const cacheLocalDataKey = async (dataKey: string) => {
  const SecureStore = require('expo-secure-store');
  const normalized = activateDataKey(dataKey);
  await SecureStore.setItemAsync(STORAGE_KEY, normalized, secureStoreOptions);
  await Promise.resolve(SecureStore.deleteItemAsync(LEGACY_STORAGE_KEY, secureStoreOptions)).catch(() => {});
  return normalized;
};

export const clearLocalDataKey = async () => {
  const SecureStore = require('expo-secure-store');
  clearEncryptionKey();
  await Promise.allSettled([
    SecureStore.deleteItemAsync(STORAGE_KEY, secureStoreOptions),
    SecureStore.deleteItemAsync(LEGACY_STORAGE_KEY, secureStoreOptions),
  ]);
};

export const bootstrapLocalEncryptionFromPassword = async (password: string, encryption?: { wrappedDataKey?: string; salt?: string; keyWrapKdf?: string } | null) => {
  const dataKey = unwrapDataKeyWithPassword(password, encryption);
  return cacheLocalDataKey(dataKey);
};

export const initLocalEncryptionKey = async () => {
  const key = await readStoredDataKey();
  if (!isValidKey(key)) {
    clearEncryptionKey();
    return '';
  }
  return cacheLocalDataKey(key);
};
