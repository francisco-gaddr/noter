import type { Store, ClientRateLimitInfo } from 'express-rate-limit';
import { createClient } from 'redis';
import logger from '../utils/logger';

const getRedisUrl = () => {
  const raw = process.env.REDIS_URL;
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

let client: ReturnType<typeof createClient> | null = null;
let connectPromise: Promise<void> | null = null;

const getClient = () => {
  const redisUrl = getRedisUrl();
  if (!redisUrl) return null;
  if (client) return client;
  client = createClient({ url: redisUrl });
  client.on('error', (err) => {
    logger.error('Redis rate-limit client error', { error: (err as Error)?.message || String(err) });
  });
  return client;
};

const ensureConnected = async () => {
  const redisClient = getClient();
  if (!redisClient) return null;
  if (redisClient.isOpen) return redisClient;
  if (connectPromise) {
    await connectPromise;
    return redisClient;
  }
  connectPromise = (async () => {
    try {
      await redisClient.connect();
    } finally {
      connectPromise = null;
    }
  })();
  await connectPromise;
  return redisClient;
};

const computeResetTime = (ttlMs: number): Date | undefined => {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) return undefined;
  return new Date(Date.now() + ttlMs);
};

export const isRedisRateLimitConfigured = () => Boolean(getRedisUrl());

export const createRedisRateLimitStore = (prefix: string): Store | undefined => {
  if (!getRedisUrl()) return undefined;
  const normalizedPrefix = prefix.endsWith(':') ? prefix : `${prefix}:`;

  let windowMs = 60_000;

  const store: Store = {
    localKeys: false,
    prefix: normalizedPrefix,
    init: (options) => {
      windowMs = typeof options.windowMs === 'number' ? options.windowMs : 60_000;
    },
    get: async (key): Promise<ClientRateLimitInfo | undefined> => {
      const redisClient = await ensureConnected();
      if (!redisClient) return undefined;
      const redisKey = `${normalizedPrefix}${key}`;
      const [countRaw, ttlMs] = await Promise.all([
        redisClient.get(redisKey),
        redisClient.pTTL(redisKey),
      ]);
      if (!countRaw) return undefined;
      const totalHits = Number.parseInt(countRaw, 10);
      return {
        totalHits: Number.isFinite(totalHits) && totalHits >= 0 ? totalHits : 0,
        resetTime: computeResetTime(ttlMs),
      };
    },
    increment: async (key) => {
      const redisClient = await ensureConnected();
      if (!redisClient) return { totalHits: 1, resetTime: computeResetTime(windowMs) };
      const redisKey = `${normalizedPrefix}${key}`;
      const totalHits = await redisClient.incr(redisKey);
      if (totalHits === 1) {
        await redisClient.pExpire(redisKey, windowMs);
      }
      let ttlMs = await redisClient.pTTL(redisKey);
      if (ttlMs === -1) {
        await redisClient.pExpire(redisKey, windowMs);
        ttlMs = await redisClient.pTTL(redisKey);
      }
      return {
        totalHits,
        resetTime: computeResetTime(ttlMs),
      };
    },
    decrement: async (key) => {
      const redisClient = await ensureConnected();
      if (!redisClient) return;
      const redisKey = `${normalizedPrefix}${key}`;
      const next = await redisClient.decr(redisKey);
      if (next <= 0) {
        await redisClient.del(redisKey);
      }
    },
    resetKey: async (key) => {
      const redisClient = await ensureConnected();
      if (!redisClient) return;
      const redisKey = `${normalizedPrefix}${key}`;
      await redisClient.del(redisKey);
    },
    shutdown: async () => {
      if (!client) return;
      try {
        if (client.isOpen) {
          await client.quit();
        }
      } catch {
      } finally {
        client = null;
        connectPromise = null;
      }
    },
  };

  return store;
};

