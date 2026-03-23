import { setEncryptionKey } from '@repo/shared';

const STORAGE_KEY = 'local_encryption_key_v1';
const KEY_PATTERN = /^[a-f0-9]{64}$/i;

const toHex = (bytes: Uint8Array) => Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
const isValidKey = (key: unknown): key is string => typeof key === 'string' && KEY_PATTERN.test(key);

export const initLocalEncryptionKey = async () => {
  const SecureStore = require('expo-secure-store');
  const Crypto = require('expo-crypto');
  let key = await SecureStore.getItemAsync(STORAGE_KEY);
  if (!isValidKey(key)) {
    const bytes: Uint8Array = await Crypto.getRandomBytesAsync(32);
    key = toHex(bytes);
    await SecureStore.setItemAsync(STORAGE_KEY, key);
  }
  setEncryptionKey(key);
  return key;
};
