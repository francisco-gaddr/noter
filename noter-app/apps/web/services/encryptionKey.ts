import { setEncryptionKey } from '@repo/shared';

const STORAGE_KEY = 'local_encryption_key_v1';
const ELECTRON_STORAGE_KEY = 'localEncryptionKey';
const KEY_PATTERN = /^[a-f0-9]{64}$/i;

const randomHex = (bytes: number) => {
  if (!window.crypto?.getRandomValues) throw new Error('Secure RNG unavailable');
  const arr = new Uint8Array(bytes);
  window.crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('');
};
const isValidKey = (key: unknown): key is string => typeof key === 'string' && KEY_PATTERN.test(key);

export const initWebEncryptionKey = async () => {
  if (typeof window === 'undefined') return '';
  const isElectron = Boolean((window as any).mlc?.isElectron);
  let key = '';
  const electronGet = (window as any).mlc?.getSetting;
  const electronSet = (window as any).mlc?.setSetting;
  if (isElectron && typeof (window as any).mlc?.getSetting === 'function') {
    try {
      const stored = await (window as any).mlc.getSetting(ELECTRON_STORAGE_KEY);
      if (isValidKey(stored)) key = stored.trim();
    } catch {}
  }
  if (!key && !isElectron) {
    key = localStorage.getItem(STORAGE_KEY) || '';
  }
  if (!isValidKey(key)) {
    key = randomHex(32);
  }
  if (isElectron) {
    if (typeof electronGet !== 'function' || typeof electronSet !== 'function') {
      localStorage.removeItem(STORAGE_KEY);
      setEncryptionKey(key);
      return key;
    }
    const legacyLocal = localStorage.getItem(STORAGE_KEY);
    if (!isValidKey(await electronGet(ELECTRON_STORAGE_KEY)) && isValidKey(legacyLocal)) {
      key = legacyLocal;
    }
    await electronSet(ELECTRON_STORAGE_KEY, key);
    localStorage.removeItem(STORAGE_KEY);
  } else {
    localStorage.setItem(STORAGE_KEY, key);
  }
  setEncryptionKey(key);
  return key;
};
