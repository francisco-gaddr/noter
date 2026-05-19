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

export const closeRateLimitRedis = async (): Promise<void> => {
  if (!redisClient) return;
  try { await redisClient.quit(); } catch { /* noop */ }
  redisClient = null;
  redisReady = false;
};
