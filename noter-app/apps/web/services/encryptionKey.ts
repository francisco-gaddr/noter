import { setEncryptionKey } from '@repo/shared';

const STORAGE_KEY = 'local_encryption_key_v1';
const ELECTRON_STORAGE_KEY = 'localEncryptionKey';

const randomHex = (bytes: number) => {
  const arr = new Uint8Array(bytes);
  window.crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, '0')).join('');
};

export const initWebEncryptionKey = async () => {
  if (typeof window === 'undefined') return '';
  const isElectron = Boolean((window as any).mlc?.isElectron);
  let key = '';
  if (isElectron && typeof (window as any).mlc?.getSetting === 'function') {
    try {
      const stored = await (window as any).mlc.getSetting(ELECTRON_STORAGE_KEY);
      if (typeof stored === 'string' && stored.trim()) key = stored.trim();
    } catch {}
  }
  if (!key) {
    key = localStorage.getItem(STORAGE_KEY) || '';
  }
  if (!key) {
    key = randomHex(32);
  }
  if (isElectron && typeof (window as any).mlc?.setSetting === 'function') {
    try {
      await (window as any).mlc.setSetting(ELECTRON_STORAGE_KEY, key);
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      localStorage.setItem(STORAGE_KEY, key);
    }
  } else {
    localStorage.setItem(STORAGE_KEY, key);
  }
  setEncryptionKey(key);
  return key;
};
