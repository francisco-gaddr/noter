import type { Request, Response, NextFunction } from 'express';

/**
 * Sliding-window rate limiter (in-memory).
 *
 * Why this exists alongside the fixed-window limiter from round 5:
 *   - Fixed windows let a client send `2 * points` in a 1-second burst
 *     straddling the window boundary (the "double-tap" problem).
 *   - Sliding windows track timestamps inside a rolling window so the
 *     effective rate stays bounded regardless of when in the window
 *     requests arrive.
 *
 * Tradeoff: more memory per key (we keep timestamps, not a counter). To
 * cap memory we evict the oldest entries past the window on every check
 * AND hard-cap each key's buffer at 2× points.
 *
 * Single-process by design — for multi-pod you'd back this with a Redis
 * sorted set. We expose the buckets via `_getSnapshot()` so a future Redis
 * adapter can mirror the same shape.
 */

const SWEEP_SIZE_THRESHOLD = 256;

interface Bucket {
  /** Sorted-asc request timestamps (ms). */
  hits: number[];
}

export interface SlidingWindowOptions {
  /** Maximum requests in the window. */
  points: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /** Optional per-key prefix so this limiter doesn't clash with another. */
  keyPrefix?: string;
  /** Optional key extractor; default is IP-based via X-Forwarded-For / req.ip. */
  keyResolver?: (req: Request) => string;
}

const defaultKeyResolver = (req: Request): string => {
  const xff = req.headers['x-forwarded-for'];
  const xffStr = Array.isArray(xff) ? xff[0] : (typeof xff === 'string' ? xff.split(',')[0]?.trim() : undefined);
  return (xffStr || req.ip || 'unknown').slice(0, 64);
};

const stores = new Map<string, Map<string, Bucket>>();

const getStore = (prefix: string): Map<string, Bucket> => {
  let store = stores.get(prefix);
  if (!store) {
    store = new Map();
    stores.set(prefix, store);
  }
  return store;
};

/**
 * Check-and-record. Returns
 *   { ok: true, remaining, resetMs }  → request allowed
 *   { ok: false, retryAfterMs }       → rate-limited
 *
 * Pure-enough to test directly (memory store, no Redis), exposed via the
 * exported helper. The express middleware below wraps it.
 */
export const checkSlidingWindow = (
  prefix: string,
  key: string,
  opts: { points: number; windowMs: number },
  now: number = Date.now(),
): { ok: true; remaining: number; resetMs: number } | { ok: false; retryAfterMs: number } => {
  const { points, windowMs } = opts;
  const store = getStore(prefix);
  const bucket = store.get(key) ?? { hits: [] };

  // Evict expired timestamps. The list is sorted ascending so we walk the
  // front until we hit something still in-window.
  const windowStart = now - windowMs;
  let evictFrom = 0;
  while (evictFrom < bucket.hits.length && bucket.hits[evictFrom] <= windowStart) {
    evictFrom++;
  }
  if (evictFrom > 0) bucket.hits = bucket.hits.slice(evictFrom);

  if (bucket.hits.length >= points) {
    const oldest = bucket.hits[0];
    const retryAfterMs = oldest + windowMs - now;
    store.set(key, bucket);
    return { ok: false, retryAfterMs: Math.max(0, retryAfterMs) };
  }

  bucket.hits.push(now);
  // Hard cap defensive — shouldn't trigger given the check above, but
  // protects against weird out-of-order timestamps from clock-skew tests.
  if (bucket.hits.length > points * 2) {
    bucket.hits = bucket.hits.slice(-points * 2);
  }
  store.set(key, bucket);

  // Periodic GC of empty buckets to avoid the map growing forever for
  // ephemeral IPs.
  if (store.size > SWEEP_SIZE_THRESHOLD) {
    for (const [k, v] of store) {
      if (v.hits.length === 0 || v.hits[v.hits.length - 1] <= windowStart) store.delete(k);
    }
  }

  const resetMs = (bucket.hits[0] ?? now) + windowMs - now;
  return { ok: true, remaining: points - bucket.hits.length, resetMs };
};

export const slidingWindowRateLimit = (opts: SlidingWindowOptions) => {
  const prefix = opts.keyPrefix ?? 'sw';
  const resolveKey = opts.keyResolver ?? defaultKeyResolver;
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = resolveKey(req);
    const result = checkSlidingWindow(prefix, key, { points: opts.points, windowMs: opts.windowMs });
    if (result.ok) {
      res.setHeader('X-RateLimit-Limit', String(opts.points));
      res.setHeader('X-RateLimit-Remaining', String(result.remaining));
      res.setHeader('X-RateLimit-Reset', String(Math.ceil(result.resetMs / 1000)));
      return next();
    }
    res.setHeader('Retry-After', String(Math.ceil(result.retryAfterMs / 1000)));
    res.status(429).json({ message: 'Too many requests', code: 'TOO_MANY_REQUESTS' });
  };
};

export const _clearSlidingWindow = (): void => { stores.clear(); };
export const _getSnapshot = (prefix: string, key: string): number[] => {
  const store = stores.get(prefix);
  if (!store) return [];
  return (store.get(key)?.hits ?? []).slice();
};
