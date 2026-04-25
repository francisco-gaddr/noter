import CryptoJS from 'crypto-js';
import { decrypt, encrypt, setEncryptionKey } from './encrypt';
import type { AuthResponse } from './types';

const DATA_KEY_PATTERN = /^[a-f0-9]{64}$/i;
const KEY_WRAP_KDF = 'pbkdf2-sha256';
const KEY_WRAP_VERSION = 1;
const PBKDF2_ITERATIONS = 200_000;

export type WrappedEncryptionPayload = NonNullable<AuthResponse['encryption']>;

const randomHex = (bytes: number) => CryptoJS.lib.WordArray.random(bytes).toString(CryptoJS.enc.Hex);

const deriveRootKey = (password: string, salt: string) =>
  CryptoJS.PBKDF2(password, CryptoJS.enc.Hex.parse(salt), {
    keySize: 256 / 32,
    iterations: PBKDF2_ITERATIONS,
    hasher: CryptoJS.algo.SHA256,
  }).toString(CryptoJS.enc.Hex);

const ensureValidDataKey = (value: string) => {
  const normalized = String(value || '').trim();
  if (!DATA_KEY_PATTERN.test(normalized)) {
    throw new Error('Wrapped data key could not be unwrapped');
  }
  return normalized;
};

export const createPasswordWrappedEncryption = (password: string) => {
  const normalizedPassword = String(password || '');
  if (!normalizedPassword) {
    throw new Error('Password is required to create encryption material');
  }
  const salt = randomHex(16);
  const dataKey = randomHex(32);
  const rootKey = deriveRootKey(normalizedPassword, salt);
  const wrappedDataKey = encrypt(dataKey, rootKey);
  return {
    dataKey,
    wrappedDataKey,
    salt,
    keyWrapVersion: KEY_WRAP_VERSION,
    keyWrapKdf: KEY_WRAP_KDF,
  };
};

export const unwrapDataKeyWithPassword = (password: string, encryption?: Partial<WrappedEncryptionPayload> | null) => {
  const normalizedPassword = String(password || '');
  const wrappedDataKey = String(encryption?.wrappedDataKey || '').trim();
  const salt = String(encryption?.salt || '').trim();
  const keyWrapKdf = String(encryption?.keyWrapKdf || KEY_WRAP_KDF).trim();
  if (!normalizedPassword || !wrappedDataKey || !salt) {
    throw new Error('Encryption bootstrap data is incomplete');
  }
  if (keyWrapKdf !== KEY_WRAP_KDF) {
    throw new Error(`Unsupported key wrap KDF: ${keyWrapKdf}`);
  }
  const rootKey = deriveRootKey(normalizedPassword, salt);
  return ensureValidDataKey(decrypt(wrappedDataKey, rootKey));
};

export const activateDataKey = (dataKey: string) => {
  const normalized = ensureValidDataKey(dataKey);
  setEncryptionKey(normalized);
  return normalized;
};
