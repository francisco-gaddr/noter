import { encrypt, decrypt } from '@repo/shared';

export const setEncryptedItem = (key: string, value: string) => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(key, encrypt(value));
};

export const getEncryptedItem = (key: string): string | null => {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    return decrypt(raw);
  } catch {
    return raw;
  }
};

export const removeEncryptedItem = (key: string) => {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(key);
};

export const setEncryptedJson = (key: string, value: unknown) => {
  setEncryptedItem(key, JSON.stringify(value));
};

export const getEncryptedJson = <T = unknown>(key: string): T | null => {
  const raw = getEncryptedItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};
