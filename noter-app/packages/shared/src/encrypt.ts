import CryptoJS from 'crypto-js';

const DEFAULT_KEY = 'noter-default-key';
let activeKey = DEFAULT_KEY;
const ENCRYPTED_PREFIX = 'U2FsdGVkX1';
export type DecryptSource = 'active' | 'legacy' | 'plaintext' | 'failed';
export type DecryptResult = { value: string; source: DecryptSource };
const scoreDecryptedText = (value: string) => {
  if (!value) return -1;
  let score = 0;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code === 0) return -1;
    if ((code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 0xfffd) score -= 3;
    else score += 1;
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) score += 3;
  if (/^(true|false|[01])$/.test(value)) score += 2;
  if (/^(low|medium|high|none|daily|weekly)$/.test(value)) score += 2;
  if ((value.startsWith('{') && value.endsWith('}')) || (value.startsWith('[') && value.endsWith(']'))) score += 2;
  if (value.trim().length === 0) score -= 1;
  return score;
};

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

export const decryptWithSource = (ciphertext: string, key?: string): DecryptResult => {
  const resolvedKey = key && key.trim() ? key : activeKey;
  if (!ciphertext || !resolvedKey) return { value: '', source: 'failed' };
  if (!ciphertext.startsWith(ENCRYPTED_PREFIX)) return { value: ciphertext, source: 'plaintext' };
  
  let primary = '';
  let legacy = '';
  
  try {
    primary = CryptoJS.AES.decrypt(ciphertext, resolvedKey).toString(CryptoJS.enc.Utf8);
  } catch (e) {
    // Ignore primary decryption error
  }
  
  try {
    if (resolvedKey !== DEFAULT_KEY) {
      legacy = CryptoJS.AES.decrypt(ciphertext, DEFAULT_KEY).toString(CryptoJS.enc.Utf8);
    }
  } catch (e) {
    // Ignore legacy decryption error
  }

  if (primary && !legacy) return { value: primary, source: 'active' };
  if (!primary && legacy) return { value: legacy, source: 'legacy' };
  if (primary && legacy) {
    const primaryScore = scoreDecryptedText(primary);
    const legacyScore = scoreDecryptedText(legacy);
    if (legacyScore > primaryScore + 1) return { value: legacy, source: 'legacy' };
    return { value: primary, source: 'active' };
  }
  
  return { value: '', source: 'failed' };
};

export const decrypt = (ciphertext: string, key?: string): string => {
  const result = decryptWithSource(ciphertext, key);
  return result.source === 'failed' ? '' : result.value;
};
