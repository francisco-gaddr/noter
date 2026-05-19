import { perfHistogramMiddleware, getPerfSnapshot, resetPerfHistograms } from '../../src/middleware/perfHistogram';
import { EventEmitter } from 'node:events';

const makeRes = () => {
  const ee = new EventEmitter() as EventEmitter & { statusCode: number };
  ee.statusCode = 200;
  return ee;
};

const runRequest = async (method: string, routePath: string, durationMs: number, statusCode = 200) => {
  const req = { method, route: { path: routePath }, path: routePath };
  const res = makeRes();
  res.statusCode = statusCode;
  await new Promise<void>((resolve) => {
    perfHistogramMiddleware(req as any, res as any, () => {
      setTimeout(() => {
        res.emit('finish');
        resolve();
      }, durationMs);
    });
  });
};

describe('perfHistogram', () => {
  beforeEach(() => resetPerfHistograms());

  it('records p50/p95/p99 per route key', async () => {
    // 50 fast requests on /a
    for (let i = 0; i < 5; i++) {
      await runRequest('GET', '/a', 5);
    }
    const snap = getPerfSnapshot();
    const route = snap.routes.find((r) => r.route === 'GET /a');
    expect(route).toBeDefined();
    expect(route!.count).toBe(5);
    expect(route!.p50_ms).toBeGreaterThan(0);
    expect(route!.p99_ms).toBeGreaterThanOrEqual(route!.p50_ms);
  });

  it('counts errors separately', async () => {
    await runRequest('POST', '/b', 5, 500);
    await runRequest('POST', '/b', 5, 500);
    await runRequest('POST', '/b', 5, 200);
    const snap = getPerfSnapshot();
    const route = snap.routes.find((r) => r.route === 'POST /b');
    expect(route).toBeDefined();
    expect(route!.errors).toBe(2);
  });

  it('exposes uptime in seconds', () => {
    const snap = getPerfSnapshot();
    expect(typeof snap.uptimeSec).toBe('number');
    expect(snap.uptimeSec).toBeGreaterThanOrEqual(0);
  });

  it('reset() clears histograms', async () => {
    await runRequest('GET', '/c', 5);
    expect(getPerfSnapshot().routes.find((r) => r.route === 'GET /c')!.count).toBe(1);
    resetPerfHistograms();
    // After reset, count should be 0 (and so the route is filtered out)
    expect(getPerfSnapshot().routes.find((r) => r.route === 'GET /c')).toBeUndefined();
  });
});
