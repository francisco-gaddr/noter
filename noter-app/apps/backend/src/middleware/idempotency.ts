import type { Request, Response, NextFunction } from 'express';
import { createHash } from 'node:crypto';

/**
 * RFC 9457 / draft-ietf-httpapi-idempotency-key Idempotency-Key support.
 *
 * If the client sends `Idempotency-Key: <opaque>` on a mutation, we cache the
 * response under (userId, key, bodyHash). A retry of the same request returns
 * the cached response with `Idempotency-Replayed: true` so the client knows it
 * wasn't re-executed.
 *
 * Why bodyHash too: a buggy or malicious client sending a different body with
 * the same key would otherwise get a replay of an unrelated response. Hashing
 * the body and treating mismatched-body as a conflict (409) prevents this.
 *
 * Cache is in-memory LRU bounded at 1000 entries × 24h TTL. For multi-pod
 * deployments swap the Map for a Redis-backed implementation — the public
 * shape is the same.
 */

const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 1000;
const ID_PATTERN = /^[A-Za-z0-9._-]{8,128}$/;

interface CacheEntry {
  bodyHash: string;
  status: number;
  body: unknown;
  headers: Record<string, string>;
  expiresAt: number;
}

// Map keyed by `${userId}|${idempotencyKey}`. Map preserves insertion order,
// so to enforce LRU we delete+set on read; the oldest entry is .keys().next().
const cache = new Map<string, CacheEntry>();

const cacheKey = (userId: string, idempotencyKey: string): string => `${userId}|${idempotencyKey}`;

const evictExpiredOrLRU = (now: number): void => {
  // Expired sweep first (cheap; we only walk until we find a non-expired entry).
  for (const [key, entry] of cache) {
    if (entry.expiresAt > now) break;
    cache.delete(key);
  }
  // Size guard
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
};

const hashBody = (body: unknown): string => {
  const raw = body === undefined ? '' : JSON.stringify(body);
  return createHash('sha256').update(raw).digest('base64url');
};

const ANON_USER = '__anon__';

const userKey = (req: Request): string => {
  const u = (req as Request & { user?: { userId?: string } }).user?.userId;
  return typeof u === 'string' && u.length > 0 ? u : ANON_USER;
};

/**
 * Mount this on a route group that handles unsafe methods (POST/PUT/PATCH).
 * GET/HEAD/DELETE bypass — they're already idempotent semantically.
 */
export const idempotency = () => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.method !== 'POST' && req.method !== 'PUT' && req.method !== 'PATCH') {
      return next();
    }
    const raw = req.headers['idempotency-key'];
    const key = Array.isArray(raw) ? raw[0] : raw;
    if (typeof key !== 'string' || !ID_PATTERN.test(key)) {
      return next();
    }

    const now = Date.now();
    evictExpiredOrLRU(now);

    const fullKey = cacheKey(userKey(req), key);
    const bodyHash = hashBody(req.body);
    const cached = cache.get(fullKey);

    if (cached && cached.expiresAt > now) {
      if (cached.bodyHash !== bodyHash) {
        // Same key, different body — RFC says return 422 or 409. We use 409
        // because that's the conventional "conflict" status.
        res.status(409).json({
          message: 'Idempotency-Key was used with a different request body',
          extensions: { code: 'IDEMPOTENCY_KEY_REUSED' },
        });
        return;
      }
      // Touch for LRU: re-insert at the end.
      cache.delete(fullKey);
      cache.set(fullKey, cached);
      res.setHeader('Idempotency-Replayed', 'true');
      for (const [h, v] of Object.entries(cached.headers)) res.setHeader(h, v);
      res.status(cached.status).json(cached.body);
      return;
    }

    // Cache the response when the handler finishes. We patch res.json so any
    // serialised payload gets stored before being sent.
    const origJson = res.json.bind(res);
    res.json = ((body: unknown) => {
      try {
        // Only cache success — caching 5xx or validation errors would cause a
        // retry-with-same-key to get a "successful" replay of the failure.
        if (res.statusCode < 400) {
          cache.set(fullKey, {
            bodyHash,
            status: res.statusCode,
            body,
            headers: { 'Content-Type': 'application/json' },
            expiresAt: now + TTL_MS,
          });
        }
      } catch {
        // never let cache bookkeeping break the response
      }
      return origJson(body);
    }) as Response['json'];

    next();
  };
};

// Test-only helpers.
export const _idempotencyCacheSize = (): number => cache.size;
export const _clearIdempotencyCache = (): void => cache.clear();
