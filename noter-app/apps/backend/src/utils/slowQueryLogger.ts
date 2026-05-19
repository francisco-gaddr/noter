import mongoose from 'mongoose';
import logger from './logger';

const DEFAULT_THRESHOLD_MS = 100;

const getThreshold = (): number => {
  const raw = Number(process.env.SLOW_QUERY_MS_THRESHOLD);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_THRESHOLD_MS;
};

// Same allow-list as mongooseDebug — we don't want PII in our slow-query
// log either, especially because slow-query alerts often go to broader
// channels than debug logs.
const SENSITIVE_KEYS = new Set([
  'password', 'token', 'refresh', 'secret', 'apikey', 'authorization',
  'content', 'title', 'tags', 'email', 'iv', 'ciphertext',
]);

const summariseFilter = (val: unknown, depth = 0): unknown => {
  if (depth > 2) return '…';
  if (val === null || val === undefined) return val;
  if (Array.isArray(val)) return `[${val.length}]`;
  if (typeof val === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(k.toLowerCase())) {
        out[k] = '[REDACTED]';
      } else if (typeof v === 'object' && v !== null) {
        out[k] = summariseFilter(v, depth + 1);
      } else if (typeof v === 'string') {
        out[k] = v.length > 40 ? `${v.slice(0, 40)}…` : v;
      } else {
        out[k] = v;
      }
    }
    return out;
  }
  return val;
};

let installed = false;

export const installSlowQueryLogger = (): void => {
  if (installed) return;
  const threshold = getThreshold();

  // mongoose query pre/post hooks fire for every find / findOne / update etc.
  // We attach a timer in pre and read it in post. `this` is the Query object;
  // we store the timer on it so multiple concurrent queries don't collide.
  const queryOps = [
    'count', 'countDocuments', 'estimatedDocumentCount',
    'find', 'findOne', 'findOneAndDelete', 'findOneAndRemove',
    'findOneAndReplace', 'findOneAndUpdate',
    'deleteMany', 'deleteOne',
    'replaceOne', 'updateMany', 'updateOne',
    'aggregate',
  ] as const;

  for (const op of queryOps) {
    mongoose.plugin((schema) => {
      // pre hook
      schema.pre(op as any, function () {
        (this as any).__slowQueryStart = Date.now();
      });
      schema.post(op as any, function () {
        const start = (this as any).__slowQueryStart;
        if (typeof start !== 'number') return;
        const durationMs = Date.now() - start;
        if (durationMs < threshold) return;
        try {
          const filter = typeof (this as any).getFilter === 'function' ? (this as any).getFilter() : undefined;
          const collection = (this as any).model?.collection?.collectionName || 'unknown';
          logger.warn('mongoose.slow-query', {
            op,
            collection,
            durationMs,
            threshold,
            filter: summariseFilter(filter),
          });
        } catch {
          logger.warn('mongoose.slow-query', { op, durationMs, threshold });
        }
      });
    });
  }

  installed = true;
  logger.info('slow-query logger installed', { thresholdMs: threshold });
};

export { summariseFilter };
