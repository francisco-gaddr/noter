import CryptoJS from 'crypto-js';

let activeKey: string | null = null;
const ENCRYPTED_PREFIX = 'U2FsdGVkX1';
export const ENCRYPTED_V3_PREFIX = 'noter:v3:';
export type DecryptSource = 'active' | 'plaintext' | 'failed';
export type DecryptResult = { value: string; source: DecryptSource };

export const setEncryptionKey = (key: string) => {
  const trimmed = typeof key === 'string' ? key.trim() : '';
  activeKey = trimmed || null;
};

export const clearEncryptionKey = () => {
  activeKey = null;
};

export const hasEncryptionKey = () => typeof activeKey === 'string' && activeKey.length > 0;

export const getEncryptionKey = () => activeKey;

const resolveEncryptionKey = (key?: string) => {
  const trimmed = typeof key === 'string' ? key.trim() : '';
  const resolved = trimmed || activeKey;
  if (!resolved) {
    throw new Error('Encryption key has not been initialized');
  }
  return resolved;
};

const getWebCrypto = (): Crypto => {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.subtle || typeof cryptoApi.getRandomValues !== 'function') {
    throw new Error('Web Crypto is not available');
  }
  return cryptoApi;
};

const bytesToBase64 = (bytes: Uint8Array): string => {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i] as number);
  return btoa(binary);
};

const base64ToBytes = (value: string): Uint8Array => {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(value, 'base64'));
  }
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

const encodeUtf8 = (value: string): Uint8Array => {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(value);
  }
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(value, 'utf8'));
  }
  throw new Error('UTF-8 encoder is not available');
};

const decodeUtf8 = (value: BufferSource): string => {
  if (typeof TextDecoder !== 'undefined') {
    return new TextDecoder().decode(value);
  }
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(value as ArrayBuffer).toString('utf8');
  }
  throw new Error('UTF-8 decoder is not available');
};

const hexToBytes = (value: string): Uint8Array | null => {
  const normalized = value.trim();
  if (!/^[0-9a-f]{64}$/i.test(normalized)) return null;
  const bytes = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < normalized.length; i += 2) {
    bytes[i / 2] = Number.parseInt(normalized.slice(i, i + 2), 16);
  }
  return bytes;
};

const deriveV3KeyBytes = async (key?: string) => {
  const resolved = resolveEncryptionKey(key);
  const asHex = hexToBytes(resolved);
  if (asHex) return asHex;
  const cryptoApi = getWebCrypto();
  const digest = await cryptoApi.subtle.digest('SHA-256', toArrayBuffer(encodeUtf8(resolved)));
  return new Uint8Array(digest);
};

const importV3Key = async (key?: string, usage: KeyUsage = 'encrypt') => {
  const cryptoApi = getWebCrypto();
  const keyBytes = await deriveV3KeyBytes(key);
  return cryptoApi.subtle.importKey('raw', toArrayBuffer(keyBytes), 'AES-GCM', false, [usage]);
};

export const isV3Ciphertext = (value: unknown): value is string =>
  typeof value === 'string' && value.startsWith(ENCRYPTED_V3_PREFIX);

export const encrypt = (text: string, key?: string): string => {
  const resolvedKey = resolveEncryptionKey(key);
  return CryptoJS.AES.encrypt(text, resolvedKey).toString();
};

export const encryptV3 = async (text: string, key?: string): Promise<string> => {
  const cryptoApi = getWebCrypto();
  const cryptoKey = await importV3Key(key, 'encrypt');
  const iv = cryptoApi.getRandomValues(new Uint8Array(12));
  const ciphertext = await cryptoApi.subtle.encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv) },
    cryptoKey,
    toArrayBuffer(encodeUtf8(String(text ?? ''))),
  );
  return `${ENCRYPTED_V3_PREFIX}${bytesToBase64(iv)}:${bytesToBase64(new Uint8Array(ciphertext))}`;
};

export const decryptWithSource = (ciphertext: string, key?: string): DecryptResult => {
  if (!ciphertext) return { value: '', source: 'failed' };
  if (!ciphertext.startsWith(ENCRYPTED_PREFIX)) return { value: ciphertext, source: 'plaintext' };

  let resolvedKey = '';
  try {
    resolvedKey = resolveEncryptionKey(key);
  } catch {
    return { value: '', source: 'failed' };
  }

  try {
    const primary = CryptoJS.AES.decrypt(ciphertext, resolvedKey).toString(CryptoJS.enc.Utf8);
    if (primary) return { value: primary, source: 'active' };
  } catch {
  }

  return { value: '', source: 'failed' };
};

export const decryptV3 = async (ciphertext: string, key?: string): Promise<string> => {
  if (!isV3Ciphertext(ciphertext)) return '';
  const serialized = ciphertext.slice(ENCRYPTED_V3_PREFIX.length);
  const [ivBase64, payloadBase64] = serialized.split(':');
  if (!ivBase64 || !payloadBase64) return '';

  try {
    const cryptoApi = getWebCrypto();
    const cryptoKey = await importV3Key(key, 'decrypt');
    const decrypted = await cryptoApi.subtle.decrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(base64ToBytes(ivBase64)) },
      cryptoKey,
      toArrayBuffer(base64ToBytes(payloadBase64)),
    );
    return decodeUtf8(decrypted);
  } catch {
    return '';
  }
};

export const decrypt = (ciphertext: string, key?: string): string => {
  const result = decryptWithSource(ciphertext, key);
  return result.source === 'failed' ? '' : result.value;
};
