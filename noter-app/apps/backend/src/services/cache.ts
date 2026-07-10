import { createClient } from 'redis';
import logger from '../utils/logger';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

const client = createClient({ url: REDIS_URL });

client.on('error', (err) => {
  logger.error('redis: client error', { error: (err as Error)?.message });
});

/** After a failed connect, skip reconnect attempts for this long so a down Redis doesn't add a
 *  connect-timeout of latency to EVERY request while degraded. */
const RECONNECT_COOLDOWN_MS = 30_000;
let nextConnectAttempt = 0;

const ensureConnected = async () => {
  if (!client.isOpen) {
    const now = Date.now();
    if (now < nextConnectAttempt) throw new Error('redis unavailable (reconnect cooldown)');
    try {
      await client.connect();
    } catch (err) {
      nextConnectAttempt = now + RECONNECT_COOLDOWN_MS;
      logger.error('redis: failed to connect', { error: (err as Error)?.message });
      throw err;
    }
  }
};

// The cache is an OPTIMIZATION, never a dependency: every entry has a TTL and the source of
// truth is Mongo. A Redis outage must therefore degrade to cache misses/no-ops — NOT 500 the
// notes read path, and NOT fail a write whose note.save() already succeeded. (The TTL also
// bounds staleness from invalidations skipped during an outage.)
const get = async <T = any>(key: string): Promise<T | null> => {
  try {
    await ensureConnected();
    const raw = await client.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return raw as unknown as T;
    }
  } catch (err) {
    logger.warn('redis: get failed — treating as cache miss', { key, error: (err as Error)?.message });
    return null;
  }
};

const set = async (key: string, value: any, ttlSeconds?: number): Promise<void> => {
  try {
    await ensureConnected();
    const payload = JSON.stringify(value);
    if (ttlSeconds && ttlSeconds > 0) {
      await client.set(key, payload, { EX: ttlSeconds });
    } else {
      await client.set(key, payload);
    }
  } catch (err) {
    logger.warn('redis: set skipped (cache degraded)', { key, error: (err as Error)?.message });
  }
};

const del = async (key: string): Promise<void> => {
  try {
    await ensureConnected();
    await client.del(key);
  } catch (err) {
    logger.warn('redis: del skipped (cache degraded)', { key, error: (err as Error)?.message });
  }
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
    logger.error('redis: failed to close cache client', { error: (err as Error)?.message });
  }
};

export default { get, set, del, close };

