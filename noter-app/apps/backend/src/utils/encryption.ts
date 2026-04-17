const ENCRYPTED_PREFIXES = ['U2FsdGVkX1', 'noter:v1:', 'noter:v2:'];

export const isEncryptedPayload = (value: unknown): boolean => {
  if (typeof value !== 'string') return false;
  if (/\s/.test(value)) return false;
  if (!ENCRYPTED_PREFIXES.some((prefix) => value.startsWith(prefix))) return false;
  if (value.length < 16) return false;
  return true;
};
