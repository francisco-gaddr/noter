const ENCRYPTED_PREFIX = 'U2FsdGVkX1';

export const isEncryptedPayload = (value: unknown): boolean => {
  if (typeof value !== 'string') return false;
  if (!value.startsWith(ENCRYPTED_PREFIX)) return false;
  if (value.length < ENCRYPTED_PREFIX.length + 8) return false;
  if (/\s/.test(value)) return false;
  return true;
};
