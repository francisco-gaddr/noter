const SENSITIVE_LOG_KEYS = new Set([
  'authorization',
  'password',
  'unlockpassword',
  'token',
  'refreshtoken',
  'secret',
  'wrappeddatakey',
  'encryptionsalt',
  'localdatakey',
]);

export const redactLogValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(redactLogValue);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const key = String(k).toLowerCase();
      if (SENSITIVE_LOG_KEYS.has(key)) {
        out[k] = '[REDACTED]';
        continue;
      }
      out[k] = redactLogValue(v);
    }
    return out;
  }
  if (typeof value === 'string') {
    const bearer = value.match(/^\s*bearer\s+(.+)$/i);
    if (bearer) return 'Bearer [REDACTED]';
  }
  return value;
};

export const sanitizeErrorForLog = (error: unknown) => {
  const err: any = error;
  if (!err || typeof err !== 'object') return redactLogValue(error);
  return redactLogValue({
    name: err.name,
    message: err.message,
    status: err.status,
    url: err.url,
    method: err.method,
    code: err.code,
    details: err.details,
  });
};

