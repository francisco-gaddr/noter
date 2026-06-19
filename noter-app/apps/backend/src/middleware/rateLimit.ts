import type { Request, Response, NextFunction } from 'express';
import { RateLimiterRedis, RateLimiterMemory, type RateLimiterAbstract } from 'rate-limiter-flexible';
import { createClient, type RedisClientType } from 'redis';
import logger from '../utils/logger';

let redisClient: RedisClientType | null = null;
let redisReady = false;

const buildRedis = (): RedisClientType | null => {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  try {
    const client = createClient({
      url,
      socket: {
        // Important: rate-limiter-flexible expects a "legacy mode" or modern client.
        // We use the modern client and pass `useRedisPackage: true` flag below.
        reconnectStrategy: (attempts) => Math.min(attempts * 50, 2000),
        connectTimeout: 5000,
      },
    });
    client.on('error', (err) => {
      redisReady = false;
      logger.warn('redis.rateLimit.error', { error: (err as Error)?.message });
    });
    client.on('ready', () => {
      redisReady = true;
      logger.info('redis.rateLimit.ready');
    });
    client.on('end', () => { redisReady = false; });
    client.connect().catch((err) => {
      logger.warn('redis.rateLimit.connect-failed', { error: (err as Error)?.message });
    });
    return client as unknown as RedisClientType;
  } catch (err) {
    logger.warn('redis.rateLimit.build-failed', { error: (err as Error)?.message });
    return null;
  }
};

const ensureRedis = (): RedisClientType | null => {
  if (redisClient) return redisClient;
  redisClient = buildRedis();
  return redisClient;
};

export interface RateLimitOptions {
  keyPrefix: string;
  points: number;
  durationSec: number;
  blockDurationSec?: number;
  message?: string;
}

const buildLimiter = (opts: RateLimitOptions): { redis: RateLimiterAbstract | null; memory: RateLimiterAbstract } => {
  const memory = new RateLimiterMemory({
    keyPrefix: `mem:${opts.keyPrefix}`,
    points: opts.points,
    duration: opts.durationSec,
    blockDuration: opts.blockDurationSec ?? 0,
  });
  const client = ensureRedis();
  if (!client) return { redis: null, memory };
  const redis = new RateLimiterRedis({
    storeClient: client as unknown as Record<string, unknown>,
    keyPrefix: `rl:${opts.keyPrefix}`,
    points: opts.points,
    duration: opts.durationSec,
    blockDuration: opts.blockDurationSec ?? 0,
    // If Redis is unreachable mid-request, fall back silently rather than 5xx-ing.
    inMemoryBlockOnConsumed: opts.points + 1,
    inMemoryBlockDuration: opts.blockDurationSec ?? opts.durationSec,
  });
  return { redis, memory };
};

const keyFor = (req: Request): string => {
  const xff = req.headers['x-forwarded-for'];
  const xffStr = Array.isArray(xff) ? xff[0] : (typeof xff === 'string' ? xff.split(',')[0]?.trim() : undefined);
  return (xffStr || req.ip || 'unknown').slice(0, 64);
};

/**
 * Create an express middleware backed by Redis when REDIS_URL is set,
 * memory otherwise. Failures to read from Redis transparently fall
 * back to the in-memory limiter so a Redis outage cannot cause a 5xx storm.
 */
export const createRateLimit = (opts: RateLimitOptions) => {
  const { redis, memory } = buildLimiter(opts);
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const key = keyFor(req);
    const limiter = redis && redisReady ? redis : memory;
    try {
      const consume = await limiter.consume(key);
      res.setHeader('X-RateLimit-Limit', String(opts.points));
      res.setHeader('X-RateLimit-Remaining', String(consume.remainingPoints));
      res.setHeader('X-RateLimit-Reset', String(Math.ceil(consume.msBeforeNext / 1000)));
      next();
    } catch (rejection: unknown) {
      const r = rejection as { msBeforeNext?: number; remainingPoints?: number };
      if (typeof r?.msBeforeNext === 'number') {
        res.setHeader('Retry-After', String(Math.ceil(r.msBeforeNext / 1000)));
        res.status(429).json({ message: opts.message || 'Too many requests' });
        return;
      }
      // Unknown error talking to Redis: try memory before giving up.
      try {
        await memory.consume(key);
        next();
      } catch {
        res.status(429).json({ message: opts.message || 'Too many requests' });
      }
    }
  };
};

export interface LockoutOptions {
  keyPrefix: string;
  /** Consecutive failures allowed before the key is blocked. */
  maxFailures: number;
  /** Sliding window (seconds) over which failures accumulate. */
  windowSec: number;
  /** How long the key stays blocked once the threshold is crossed (seconds). */
  blockSec: number;
}

/**
 * A per-identity lockout counter for authentication-style endpoints (e.g. note-lock
 * verification), keyed by whatever the caller passes (use `userId:resourceId`, NOT the IP,
 * so an attacker can't brute-force one secret across many IPs or many secrets from one IP
 * within a coarse global budget). Failures are registered explicitly; a success resets the
 * counter. This implements the OWASP A07:2025 account-lockout control (block after N
 * consecutive failures, auto-reopen after a cool-down) on top of any coarse IP rate limit.
 * Redis-backed when REDIS_URL is set (shared across pods), in-memory otherwise.
 */
export const createLockoutLimiter = (opts: LockoutOptions) => {
  const { redis, memory } = buildLimiter({
    keyPrefix: opts.keyPrefix,
    points: opts.maxFailures,
    durationSec: opts.windowSec,
    blockDurationSec: opts.blockSec,
  });
  const pick = (): RateLimiterAbstract => (redis && redisReady ? redis : memory);
  return {
    /** Is this key currently locked out? Never throws — a backend hiccup fails open to "not blocked". */
    async check(key: string): Promise<{ blocked: boolean; retryAfterSec: number }> {
      try {
        const res = await pick().get(key);
        if (res && res.consumedPoints > opts.maxFailures && res.msBeforeNext > 0) {
          return { blocked: true, retryAfterSec: Math.ceil(res.msBeforeNext / 1000) };
        }
      } catch { /* treat as not blocked */ }
      return { blocked: false, retryAfterSec: 0 };
    },
    /** Record one failed attempt. Returns blocked=true once the threshold is crossed. */
    async registerFailure(key: string): Promise<{ blocked: boolean; retryAfterSec: number }> {
      try {
        await pick().consume(key, 1);
        return { blocked: false, retryAfterSec: 0 };
      } catch (rejection: unknown) {
        const r = rejection as { msBeforeNext?: number };
        if (r && typeof r.msBeforeNext === 'number') {
          return { blocked: true, retryAfterSec: Math.ceil(r.msBeforeNext / 1000) };
        }
        return { blocked: false, retryAfterSec: 0 };
      }
    },
    /** Clear the counter (call on a successful verification). */
    async reset(key: string): Promise<void> {
      try { await pick().delete(key); } catch { /* noop */ }
    },
  };
};

export const closeRateLimitRedis = async (): Promise<void> => {
  if (!redisClient) return;
  try { await redisClient.quit(); } catch { /* noop */ }
  redisClient = null;
  redisReady = false;
};
