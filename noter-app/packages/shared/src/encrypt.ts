import CryptoJS from 'crypto-js';

const DEFAULT_KEY = 'noter-default-key';

export const encrypt = (text: string, key: string = DEFAULT_KEY): string => {
  return CryptoJS.AES.encrypt(text, key).toString();
};

export const decrypt = (ciphertext: string, key: string = DEFAULT_KEY): string => {
  if (!ciphertext || !key) return '';
  try {
    const bytes = CryptoJS.AES.decrypt(ciphertext, key);
    return bytes.toString(CryptoJS.enc.Utf8);
  } catch (e) {
    // console.warn('Decryption failed', e);
    return '';
  }
};

export * from './encrypt';
