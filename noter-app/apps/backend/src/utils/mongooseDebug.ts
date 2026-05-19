import mongoose from 'mongoose';
import logger from './logger';

const SENSITIVE_KEY_PATTERNS = [
  /password/i,
  /passwordhash/i,
  /token/i,
  /refresh/i,
  /secret/i,
  /apikey/i,
  /authorization/i,
  /^content$/i,
  /^title$/i,
  /^description$/i,
  /^tags?$/i,
  /^email$/i,
  /^phone$/i,
  /^ssn$/i,
  /encryptionkey/i,
  /privatekey/i,
  /^iv$/i,
  /^ciphertext$/i,
];

const MAX_VALUE_LEN = 60;
const MAX_DEPTH = 4;

const isSensitiveKey = (key: string): boolean =>
  SENSITIVE_KEY_PATTERNS.some((re) => re.test(key));

const redactScalar = (value: unknown, sensitive: boolean): unknown => {
  if (sensitive) return '[REDACTED]';
  if (typeof value === 'string') {
    if (value.length > MAX_VALUE_LEN) return `${value.slice(0, MAX_VALUE_LEN)}…(${value.length})`;
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object' && (value as any)._bsontype === 'ObjectID') {
    return String(value);
  }
  return value;
};

const redact = (value: unknown, depth = 0, parentKey?: string): unknown => {
  if (depth > MAX_DEPTH) return '[truncated]';
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    if (value.length > 8) {
      return [...value.slice(0, 8).map((v) => redact(v, depth + 1, parentKey)), `…+${value.length - 8} more`];
    }
    return value.map((v) => redact(v, depth + 1, parentKey));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      const sensitive = isSensitiveKey(key) || (parentKey ? isSensitiveKey(parentKey) : false);
      out[key] = redact(val, depth + 1, key) ?? redactScalar(val, sensitive);
      if (typeof val !== 'object' || val === null) {
        out[key] = redactScalar(val, sensitive);
      }
    }
    return out;
  }
  return redactScalar(value, parentKey ? isSensitiveKey(parentKey) : false);
};

let installed = false;

export const installMongooseDebug = (): void => {
  if (installed) return;
  const env = process.env.NODE_ENV;
  const enableFlag = process.env.MONGOOSE_DEBUG === 'true';
  // Allowed envs: explicit MONGOOSE_DEBUG=true OR staging-flavoured envs.
  const stagingLike = env === 'staging' || env === 'preview' || env === 'qa';
  if (!enableFlag && !stagingLike) return;

  mongoose.set('debug', (collection: string, method: string, ...args: unknown[]) => {
    try {
      const redactedArgs = args.map((a) => redact(a));
      logger.debug('mongoose.query', {
        collection,
        method,
        args: redactedArgs,
      });
    } catch (err) {
      logger.warn('mongoose.debug.redaction-failed', {
        collection,
        method,
        error: (err as Error)?.message,
      });
    }
  });
  installed = true;
  logger.info('mongoose debug redactor installed', { env });
};
