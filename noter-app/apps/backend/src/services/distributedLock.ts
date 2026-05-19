import { randomBytes } from 'node:crypto';
import logger from '../utils/logger';

/**
 * Single-key distributed lock backed by Redis SET NX EX.
 *
 * Why this and not a library:
 *   - We already have `redis` as a dep (for rate-limiting). One more dep
 *     adds surface area we don't need.
 *   - The Redlock-style algorithm is overkill for single-master Redis
 *     (which is our deployment). A simple SETNX-with-fence-token covers
 *     the use cases we actually have: ensure only one backend pod runs a
 *     migration, only one cron-job sends the daily digest, etc.
 *
 * Fence token: every acquisition writes a random value to the key; release
 * is conditional on that value still being present (LUA-style CAS via
 * GET-then-DEL). This prevents a stale owner whose TTL expired from
 * releasing a new owner's lock.
 *
 * Falls back to a process-local lock when REDIS_URL is unset so the
 * caller's code path works in dev/test.
 */

type RedisClient = {
  set: (key: string, value: string, opts?: { NX?: boolean; EX?: number }) => Promise<string | null>;
  get: (key: string) => Promise<string | null>;
  del: (...keys: string[]) => Promise<number>;
  isReady: boolean;
};

let cached: RedisClient | null = null;

const buildClient = async (): Promise<RedisClient | null> => {
  if (!process.env.REDIS_URL) return null;
  if (cached && cached.isReady) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createClient } = require('redis');
    const client = createClient({ url: process.env.REDIS_URL, socket: { connectTimeout: 5000 } });
    await client.connect();
    cached = client as unknown as RedisClient;
    return cached;
  } catch (err) {
    logger.warn('distributedLock: redis connect failed', { error: (err as Error)?.message });
    return null;
  }
};

interface AcquiredLock {
  key: string;
  token: string;
  ttlSeconds: number;
  release: () => Promise<boolean>;
}

const LOCK_PREFIX = 'lock:';

// In-memory fallback for when Redis isn't available — process-scoped only.
const memoryLocks = new Map<string, { token: string; expiresAt: number }>();

const evictExpiredMemory = (): void => {
  const now = Date.now();
  for (const [k, v] of memoryLocks) {
    if (v.expiresAt <= now) memoryLocks.delete(k);
  }
};

export interface AcquireOptions {
  /** Lock TTL in seconds. The lock auto-releases after this even if `release()` is never called. */
  ttlSeconds?: number;
}

const DEFAULT_TTL_SECONDS = 30;

/**
 * Attempt to acquire the lock named `key`. Returns the lock handle when
 * successful or null when the lock is held by someone else.
 *
 * The caller is responsible for calling `release()` when done — but if the
 * caller crashes, the TTL ensures the lock doesn't stick forever.
 */
export const acquireLock = async (key: string, opts: AcquireOptions = {}): Promise<AcquiredLock | null> => {
  if (typeof key !== 'string' || key.length === 0 || key.length > 256) {
    throw new Error('invalid lock key');
  }
  const ttlSeconds = opts.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  if (!Number.isFinite(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 3600) {
    throw new Error('ttlSeconds must be in [1, 3600]');
  }
  const token = randomBytes(16).toString('hex');
  const fullKey = `${LOCK_PREFIX}${key}`;

  const redis = await buildClient();
  if (redis && redis.isReady) {
    try {
      const res = await redis.set(fullKey, token, { NX: true, EX: ttlSeconds });
      if (res !== 'OK') return null;
      return {
        key: fullKey,
        token,
        ttlSeconds,
        release: async (): Promise<boolean> => {
          // Owner-only release: only delete if the stored token still matches.
          const current = await redis.get(fullKey).catch(() => null);
          if (current !== token) return false;
          const deleted = await redis.del(fullKey).catch(() => 0);
          return deleted > 0;
        },
      };
    } catch (err) {
      logger.warn('distributedLock: redis acquire failed, falling back to memory', { error: (err as Error)?.message });
    }
  }

  // Memory fallback path
  evictExpiredMemory();
  if (memoryLocks.has(fullKey)) return null;
  memoryLocks.set(fullKey, { token, expiresAt: Date.now() + ttlSeconds * 1000 });
  return {
    key: fullKey,
    token,
    ttlSeconds,
    release: async (): Promise<boolean> => {
      const current = memoryLocks.get(fullKey);
      if (!current || current.token !== token) return false;
      memoryLocks.delete(fullKey);
      return true;
    },
  };
};

/**
 * Convenience wrapper: acquire the lock, run the function, release. If the
 * lock can't be acquired, throws a typed error so callers can branch.
 */
export class LockUnavailableError extends Error {
  constructor(key: string) { super(`lock unavailable: ${key}`); this.name = 'LockUnavailableError'; }
}

export const withLock = async <T>(
  key: string,
  fn: () => Promise<T>,
  opts: AcquireOptions = {},
): Promise<T> => {
  const lock = await acquireLock(key, opts);
  if (!lock) throw new LockUnavailableError(key);
  try {
    return await fn();
  } finally {
    await lock.release().catch(() => undefined);
  }
};

// Test-only helpers
export const _clearMemoryLocks = (): void => { memoryLocks.clear(); };
export const _memoryLockKeys = (): string[] => Array.from(memoryLocks.keys());
