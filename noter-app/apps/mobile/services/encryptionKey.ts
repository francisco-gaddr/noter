import { setEncryptionKey } from '@repo/shared';

const STORAGE_KEY = 'local_encryption_key_v1';

const toHex = (bytes: Uint8Array) => Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
const getRandomBytes = (size: number) => {
  const buffer = new Uint8Array(size);
  const cryptoApi = (globalThis as any)?.crypto;
  if (cryptoApi?.getRandomValues) {
    cryptoApi.getRandomValues(buffer);
    return buffer;
  }
  for (let i = 0; i < size; i += 1) buffer[i] = Math.floor(Math.random() * 256);
  return buffer;
};

export const initLocalEncryptionKey = async () => {
  const SecureStore = require('expo-secure-store');
  let key = await SecureStore.getItemAsync(STORAGE_KEY);
  if (!key) {
    const bytes = getRandomBytes(32);
    key = toHex(bytes);
    await SecureStore.setItemAsync(STORAGE_KEY, key);
  }
  setEncryptionKey(key);
  return key;
};
