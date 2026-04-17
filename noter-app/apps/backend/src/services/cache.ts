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
    logger.error('Redis client error', { error: (err as Error)?.message || String(err) });
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
    } catch (err) {
      logger.error('Failed to connect to Redis', { error: (err as Error)?.message || String(err) });
      throw err;
    } finally {
      connectPromise = null;
    }
  })();
  await connectPromise;
  return redisClient;
};

const get = async <T = any>(key: string): Promise<T | null> => {
  const redisClient = await ensureConnected();
  if (!redisClient) return null;
  const raw = await redisClient.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return raw as unknown as T;
  }
};

const set = async (key: string, value: any, ttlSeconds?: number): Promise<void> => {
  const redisClient = await ensureConnected();
  if (!redisClient) return;
  const payload = JSON.stringify(value);
  if (ttlSeconds && ttlSeconds > 0) {
    await redisClient.set(key, payload, { EX: ttlSeconds });
  } else {
    await redisClient.set(key, payload);
  }
};

const del = async (key: string): Promise<void> => {
  const redisClient = await ensureConnected();
  if (!redisClient) return;
  await redisClient.del(key);
};

const delMany = async (keys: string[]): Promise<void> => {
  if (!Array.isArray(keys) || keys.length === 0) return;
  const redisClient = await ensureConnected();
  if (!redisClient) return;
  const uniqueKeys = Array.from(new Set(keys.filter((key) => typeof key === 'string' && key.length > 0)));
  if (uniqueKeys.length === 0) return;
  await redisClient.del(uniqueKeys);
};

const ping = async (): Promise<boolean> => {
  const redisClient = await ensureConnected();
  if (!redisClient) return false;
  try {
    const response = await redisClient.ping();
    return response === 'PONG';
  } catch {
    return false;
  }
};

const close = async (): Promise<void> => {
  if (!client) return;
  try {
    if (client.isOpen) {
      await client.quit();
    }
  } catch {
    // Ignore shutdown errors so process shutdown can continue.
  } finally {
    client = null;
    connectPromise = null;
  }
};

export default { get, set, del, delMany, ping, close };
