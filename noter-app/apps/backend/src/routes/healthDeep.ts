import express from 'express';
import mongoose from 'mongoose';

const router = express.Router();

const TIMEOUT_MS = 1500;

const withTimeout = async <T>(p: Promise<T>, ms: number): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

interface CheckResult {
  ok: boolean;
  latencyMs?: number;
  error?: string;
  details?: Record<string, unknown>;
}

const checkMongo = async (): Promise<CheckResult> => {
  const start = Date.now();
  try {
    const conn = mongoose.connection;
    if (!conn || conn.readyState !== 1 || !conn.db) {
      return { ok: false, error: `readyState=${conn?.readyState ?? 'none'}` };
    }
    const pong = await withTimeout(conn.db.admin().ping(), TIMEOUT_MS);
    return { ok: pong?.ok === 1, latencyMs: Date.now() - start, details: { ok: pong?.ok } };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - start, error: (err as Error)?.message };
  }
};

const checkRedis = async (): Promise<CheckResult> => {
  if (!process.env.REDIS_URL) {
    return { ok: true, details: { configured: false } };
  }
  const start = Date.now();
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createClient } = require('redis');
    const client = createClient({ url: process.env.REDIS_URL, socket: { connectTimeout: TIMEOUT_MS } });
    let connected = false;
    await withTimeout(client.connect(), TIMEOUT_MS);
    connected = true;
    const pong = await withTimeout(client.ping(), TIMEOUT_MS);
    await client.quit().catch(() => undefined);
    return { ok: pong === 'PONG', latencyMs: Date.now() - start, details: { connected } };
  } catch (err) {
    return { ok: false, latencyMs: Date.now() - start, error: (err as Error)?.message };
  }
};

// Gate this endpoint behind a shared token so it can't be used as a free
// "did the server warm up" oracle for an attacker mapping our infra.
const authGuard = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const expected = process.env.HEALTH_DEEP_TOKEN;
  const provided = req.headers['x-internal-token'];
  const remote = req.ip || '';
  const isLoopback = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
  if (expected) {
    if (provided !== expected) return res.status(401).json({ message: 'unauthorized' });
  } else if (!isLoopback) {
    return res.status(401).json({ message: 'unauthorized' });
  }
  next();
};

router.get('/', authGuard, async (_req, res) => {
  const [mongo, redis] = await Promise.all([checkMongo(), checkRedis()]);
  const allOk = mongo.ok && redis.ok;
  res.status(allOk ? 200 : 503).json({
    status: allOk ? 'ok' : 'degraded',
    time: new Date().toISOString(),
    uptime_sec: Math.round(process.uptime()),
    checks: { mongo, redis },
  });
});

export default router;
