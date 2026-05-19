import { EventEmitter } from 'node:events';

// We deliberately don't set REDIS_URL so the limiter falls back to memory.
delete process.env.REDIS_URL;

import { createRateLimit } from '../../src/middleware/rateLimit';

const makeReq = (ip: string) => ({ ip, headers: {} as Record<string, string> });
const makeRes = () => {
  const r: any = new EventEmitter();
  r.statusCode = 200;
  r.headers = {} as Record<string, string>;
  r.setHeader = (k: string, v: string) => { r.headers[k] = v; };
  r.status = (n: number) => { r.statusCode = n; return r; };
  r.json = (obj: unknown) => { r.body = obj; return r; };
  return r;
};

describe('createRateLimit (memory fallback)', () => {
  it('allows requests under the limit and sets X-RateLimit headers', async () => {
    const mw = createRateLimit({ keyPrefix: `t1_${Date.now()}`, points: 3, durationSec: 60 });
    const ip = '10.0.0.1';
    for (let i = 0; i < 3; i++) {
      const res = makeRes();
      let nextCalled = false;
      await mw(makeReq(ip) as any, res as any, () => { nextCalled = true; });
      expect(nextCalled).toBe(true);
      expect(res.headers['X-RateLimit-Limit']).toBe('3');
      expect(Number(res.headers['X-RateLimit-Remaining'])).toBe(2 - i);
    }
  });

  it('returns 429 once exhausted with Retry-After', async () => {
    const mw = createRateLimit({ keyPrefix: `t2_${Date.now()}`, points: 2, durationSec: 60 });
    const ip = '10.0.0.2';
    await mw(makeReq(ip) as any, makeRes() as any, () => {});
    await mw(makeReq(ip) as any, makeRes() as any, () => {});
    const res = makeRes();
    let nextCalled = false;
    await mw(makeReq(ip) as any, res as any, () => { nextCalled = true; });
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(429);
    expect(res.headers['Retry-After']).toBeDefined();
  });

  it('keys per IP — separate IPs do not share counters', async () => {
    const mw = createRateLimit({ keyPrefix: `t3_${Date.now()}`, points: 1, durationSec: 60 });
    await mw(makeReq('10.0.0.3') as any, makeRes() as any, () => {});
    const otherRes = makeRes();
    let nextCalled = false;
    await mw(makeReq('10.0.0.4') as any, otherRes as any, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
  });

  it('prefers x-forwarded-for when present', async () => {
    const mw = createRateLimit({ keyPrefix: `t4_${Date.now()}`, points: 1, durationSec: 60 });
    const req = { ip: '127.0.0.1', headers: { 'x-forwarded-for': '203.0.113.1, 10.0.0.1' } };
    await mw(req as any, makeRes() as any, () => {});
    const res2 = makeRes();
    let nextCalled = false;
    // Same x-forwarded-for, different `ip` → still rate-limited
    await mw({ ip: '127.0.0.99', headers: { 'x-forwarded-for': '203.0.113.1' } } as any, res2 as any, () => { nextCalled = true; });
    expect(nextCalled).toBe(false);
    expect(res2.statusCode).toBe(429);
  });
});
