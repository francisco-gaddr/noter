import { activateDataKey, clearEncryptionKey, unwrapDataKeyWithPassword } from '@repo/shared';

const STORAGE_KEY = 'local_data_key_v1';
const LEGACY_STORAGE_KEY = 'local_encryption_key_v1';
const ELECTRON_STORAGE_KEY = 'localDataKey';
const LEGACY_ELECTRON_STORAGE_KEY = 'localEncryptionKey';
const KEY_PATTERN = /^[a-f0-9]{64}$/i;

const isValidKey = (key: unknown): key is string => typeof key === 'string' && KEY_PATTERN.test(key);

const getElectronBridge = () => (typeof window !== 'undefined' ? (window as any).mlc : undefined);

const readLocalStorageKey = () => {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY) || '';
};

const persistLocalStorageKey = (key: string) => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, key);
  localStorage.removeItem(LEGACY_STORAGE_KEY);
};

const clearLocalStorageKey = () => {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(LEGACY_STORAGE_KEY);
};

const readElectronKey = async () => {
  const bridge = getElectronBridge();
  if (!bridge?.isElectron || typeof bridge.getSetting !== 'function') return '';
  const [current, legacy] = await Promise.all([
    bridge.getSetting(ELECTRON_STORAGE_KEY).catch(() => ''),
    bridge.getSetting(LEGACY_ELECTRON_STORAGE_KEY).catch(() => ''),
  ]);
  return isValidKey(current) ? current.trim() : isValidKey(legacy) ? legacy.trim() : '';
};

const persistElectronKey = async (key: string) => {
  const bridge = getElectronBridge();
  if (!bridge?.isElectron) return;
  if (typeof bridge.setManySettings === 'function') {
    await bridge.setManySettings({
      [ELECTRON_STORAGE_KEY]: key,
      [LEGACY_ELECTRON_STORAGE_KEY]: null,
    });
    return;
  }
  if (typeof bridge.setSetting === 'function') {
    await Promise.all([
      bridge.setSetting(ELECTRON_STORAGE_KEY, key),
      bridge.setSetting(LEGACY_ELECTRON_STORAGE_KEY, null),
    ]);
  }
};

export const cacheWebDataKey = async (dataKey: string) => {
  const normalized = activateDataKey(dataKey);
  const bridge = getElectronBridge();
  if (bridge?.isElectron) {
    await persistElectronKey(normalized);
    clearLocalStorageKey();
    return normalized;
  }
  persistLocalStorageKey(normalized);
  return normalized;
};

export const clearWebDataKey = async () => {
  clearEncryptionKey();
  clearLocalStorageKey();
  const bridge = getElectronBridge();
  if (bridge?.isElectron && typeof bridge.setSetting === 'function') {
    await Promise.allSettled([
      bridge.setSetting(ELECTRON_STORAGE_KEY, null),
      bridge.setSetting(LEGACY_ELECTRON_STORAGE_KEY, null),
    ]);
  }
};

export const bootstrapWebEncryptionFromPassword = async (password: string, encryption?: { wrappedDataKey?: string; salt?: string; keyWrapKdf?: string } | null) => {
  const dataKey = unwrapDataKeyWithPassword(password, encryption);
  return cacheWebDataKey(dataKey);
};

export const initWebEncryptionKey = async () => {
  if (typeof window === 'undefined') return '';
  const bridge = getElectronBridge();
  const isElectron = Boolean(bridge?.isElectron);
  let key = '';
  if (isElectron) key = await readElectronKey();
  if (!key && !isElectron) key = readLocalStorageKey();
  if (isElectron) {
    if (typeof bridge?.getSetting !== 'function' || typeof bridge?.setSetting !== 'function') {
      const legacyLocal = readLocalStorageKey();
      if (isValidKey(legacyLocal)) key = legacyLocal;
      clearLocalStorageKey();
      if (isValidKey(key)) return activateDataKey(key);
      clearEncryptionKey();
      return '';
    }
    const legacyLocal = readLocalStorageKey();
    if (!isValidKey(await readElectronKey()) && isValidKey(legacyLocal)) {
      key = legacyLocal;
    }
    if (isValidKey(key)) {
      await persistElectronKey(key);
    }
    clearLocalStorageKey();
  } else {
    if (isValidKey(key)) {
      persistLocalStorageKey(key);
    }
  }
  if (!isValidKey(key)) {
    clearEncryptionKey();
    return '';
  }
  return activateDataKey(key);
};
