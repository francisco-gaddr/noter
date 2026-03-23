import CryptoJS from 'crypto-js';

const DEFAULT_KEY = 'noter-default-key';
let activeKey = DEFAULT_KEY;

export const setEncryptionKey = (key: string) => {
  const trimmed = typeof key === 'string' ? key.trim() : '';
  if (!trimmed) return;
  activeKey = trimmed;
};

export const getEncryptionKey = () => activeKey;

export const encrypt = (text: string, key?: string): string => {
  const resolvedKey = key && key.trim() ? key : activeKey;
  return CryptoJS.AES.encrypt(text, resolvedKey).toString();
};

export const decrypt = (ciphertext: string, key?: string): string => {
  const resolvedKey = key && key.trim() ? key : activeKey;
  if (!ciphertext || !resolvedKey) return '';
  try {
    const bytes = CryptoJS.AES.decrypt(ciphertext, resolvedKey);
    return bytes.toString(CryptoJS.enc.Utf8);
  } catch (e) {
    return '';
  }
};
