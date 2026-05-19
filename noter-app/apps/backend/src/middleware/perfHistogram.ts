import type { Request, Response, NextFunction } from 'express';
import { performance, createHistogram, type RecordableHistogram } from 'node:perf_hooks';

type RouteKey = string;

const histograms = new Map<RouteKey, RecordableHistogram>();
const errorCounts = new Map<RouteKey, number>();
const startedAt = Date.now();

const routeKeyFor = (req: Request): RouteKey => {
  // route.path is set after express resolves the matched route; fall back to req.path.
  const matched = (req.route && (req.route as { path?: string }).path) || req.path || 'unknown';
  return `${req.method} ${matched}`;
};

const getOrCreate = (key: RouteKey): RecordableHistogram => {
  let h = histograms.get(key);
  if (!h) {
    h = createHistogram();
    histograms.set(key, h);
  }
  return h;
};

export const perfHistogramMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const start = performance.now();
  res.on('finish', () => {
    const durMs = performance.now() - start;
    // RecordableHistogram requires integer-ns. Cap min 1, max 1h.
    const durNs = Math.max(1, Math.min(Math.round(durMs * 1e6), 3.6e12));
    const key = routeKeyFor(req);
    try {
      getOrCreate(key).record(durNs);
      if (res.statusCode >= 500) {
        errorCounts.set(key, (errorCounts.get(key) || 0) + 1);
      }
    } catch {
      // Defensive: never let the perf path crash a request.
    }
  });
  next();
};

type Snapshot = {
  route: string;
  count: number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  max_ms: number;
  errors: number;
};

const nsToMs = (ns: number): number => Math.round((ns / 1e6) * 100) / 100;

export const getPerfSnapshot = (): { uptimeSec: number; routes: Snapshot[] } => {
  const routes: Snapshot[] = [];
  for (const [route, h] of histograms.entries()) {
    if (h.count === 0) continue;
    routes.push({
      route,
      count: h.count,
      p50_ms: nsToMs(h.percentile(50)),
      p95_ms: nsToMs(h.percentile(95)),
      p99_ms: nsToMs(h.percentile(99)),
      max_ms: nsToMs(h.max),
      errors: errorCounts.get(route) || 0,
    });
  }
  routes.sort((a, b) => b.p99_ms - a.p99_ms);
  return {
    uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    routes,
  };
};

export const resetPerfHistograms = (): void => {
  for (const h of histograms.values()) h.reset();
  errorCounts.clear();
};
