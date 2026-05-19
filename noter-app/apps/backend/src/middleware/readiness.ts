import type { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';

// Routes that are SAFE to serve even while we wait for Mongo — they don't
// touch the database and they're how kubelet/load-balancer figure out our
// state. Without this allow-list a readiness-probe loop would deadlock:
//   probe → /api/health → 503 (mongo not ready) → never marks ready
const ALWAYS_AVAILABLE = [
  '/',
  '/api/health',
  '/api/health/deep',
  '/internal/perf-snapshot',
];

const isAllowed = (path: string): boolean => {
  if (ALWAYS_AVAILABLE.includes(path)) return true;
  // Allow nested paths under always-available roots (e.g. /api/health/deep/anything)
  return ALWAYS_AVAILABLE.some((p) => p !== '/' && path.startsWith(`${p}/`));
};

/**
 * Returns 503 with `Retry-After: 1` until Mongo connection is ready. Doesn't
 * gate health-check paths or static probes — those need to succeed for the
 * probe loop to make progress.
 *
 * Behaviour while gated:
 *   - readyState 0/3/99 (disconnected / disconnecting / uninitialized) → 503
 *   - readyState 1 (connected) → pass through
 *   - readyState 2 (connecting) → 503 (still warming)
 *
 * When MONGO_URI is intentionally unset (offline dev, in-memory tests) we
 * skip the gate entirely so dev iterations don't hit confusing 503s.
 */
export const readinessGate = (req: Request, res: Response, next: NextFunction): void => {
  // Bypass entirely in tests so supertest doesn't get 503'd before the route
  // handler runs — tests stub their own mongo state via mongodb-memory-server
  // or by not connecting at all.
  if (process.env.NODE_ENV === 'test') return next();
  if (!process.env.MONGO_URI) return next();
  if (isAllowed(req.path)) return next();
  const state = mongoose.connection?.readyState;
  if (state === 1) return next();
  res.setHeader('Retry-After', '1');
  res.setHeader('Connection', 'close');
  res.status(503).json({ message: 'Service warming up', mongo_state: state ?? null });
};

export const isMongoReady = (): boolean => mongoose.connection?.readyState === 1;
