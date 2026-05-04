const MAX_DEPTH = 6;

const REDACTED = '[REDACTED]';

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

const shouldRedactKey = (key: string): boolean => {
  const lowered = key.toLowerCase();
  if (lowered === 'authorization') return true;
  if (lowered === 'cookie' || lowered === 'set-cookie') return true;
  if (lowered === 'password' || lowered === 'passcode') return true;
  if (lowered === 'unlockpassword') return true;
  if (lowered.endsWith('password')) return true;
  if (lowered.includes('token')) return true;
  if (lowered.includes('secret')) return true;
  if (lowered === 'apikey' || lowered === 'api_key' || lowered.includes('api_key')) return true;
  if (lowered.includes('privatekey') || lowered.includes('private_key')) return true;
  return false;
};

const redactStringValue = (value: string): string => {
  const trimmed = value.trim();
  if (/^bearer\s+/i.test(trimmed)) return 'Bearer ' + REDACTED;
  if (/^eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/.test(trimmed)) return REDACTED;
  return value;
};

const sanitizeValue = (value: unknown, depth: number): unknown => {
  if (value == null) return value;
  if (depth >= MAX_DEPTH) return value;
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, depth + 1));
  if (typeof value === 'string') return redactStringValue(value);
  if (!isPlainObject(value)) return value;
  const next: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (shouldRedactKey(key)) {
      next[key] = REDACTED;
      continue;
    }
    next[key] = sanitizeValue(child, depth + 1);
  }
  return next;
};

export const sanitizeLogInfo = (info: Record<string, any>): Record<string, any> => {
  const next: Record<string, any> = {};
  for (const [key, value] of Object.entries(info)) {
    if (key === 'message' || key === 'level') {
      next[key] = value;
      continue;
    }
    next[key] = shouldRedactKey(key) ? REDACTED : sanitizeValue(value, 0);
  }
  return next;
};

