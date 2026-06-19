import { createClient } from 'redis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

const client = createClient({ url: REDIS_URL });

client.on('error', (err) => {
  console.error('Redis Client Error', err);
});

const ensureConnected = async () => {
  if (!client.isOpen) {
    try {
      await client.connect();
    } catch (err) {
      console.error('Failed to connect to Redis', err);
      throw err;
    }
  }
};

const get = async <T = any>(key: string): Promise<T | null> => {
  await ensureConnected();
  const raw = await client.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return raw as unknown as T;
  }
};

const set = async (key: string, value: any, ttlSeconds?: number): Promise<void> => {
  await ensureConnected();
  const payload = JSON.stringify(value);
  if (ttlSeconds && ttlSeconds > 0) {
    await client.set(key, payload, { EX: ttlSeconds });
  } else {
    await client.set(key, payload);
  }
};

const del = async (key: string): Promise<void> => {
  await ensureConnected();
  await client.del(key);
};

/**
 * Cleanly close the cache connection on shutdown. Without this the Redis client lingers as an
 * open handle (zombie connection) after the process is asked to stop. Safe to call when never
 * connected. Registered in the graceful-shutdown sequence.
 */
const close = async (): Promise<void> => {
  try {
    if (client.isOpen) await client.quit();
  } catch (err) {
    console.error('Failed to close Redis cache client', err);
  }
};

export default { get, set, del, close };

