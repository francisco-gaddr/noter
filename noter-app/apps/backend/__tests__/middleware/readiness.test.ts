import { readinessGate } from '../../src/middleware/readiness';

jest.mock('mongoose', () => ({
  __esModule: true,
  default: { connection: { readyState: 0 } },
}));

import mongoose from 'mongoose';

const makeReq = (path: string) => ({ path });
const makeRes = () => {
  const r: any = {};
  r.statusCode = 200;
  r.headers = {} as Record<string, string>;
  r.setHeader = (k: string, v: string) => { r.headers[k] = v; };
  r.status = (n: number) => { r.statusCode = n; return r; };
  r.json = (b: unknown) => { r.body = b; return r; };
  return r;
};

describe('readinessGate', () => {
  const originalMongoUri = process.env.MONGO_URI;
  const originalNodeEnv = process.env.NODE_ENV;
  beforeEach(() => {
    process.env.NODE_ENV = 'production'; // simulate non-test path
    process.env.MONGO_URI = 'mongodb://localhost:27017/test';
    (mongoose.connection as any).readyState = 0;
  });
  afterAll(() => {
    process.env.MONGO_URI = originalMongoUri;
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('always passes through when NODE_ENV=test (so integration tests work)', () => {
    process.env.NODE_ENV = 'test';
    const res = makeRes();
    let n = false;
    readinessGate(makeReq('/api/notes') as any, res as any, () => { n = true; });
    expect(n).toBe(true);
  });

  it('passes through when MONGO_URI is unset (dev mode)', () => {
    delete process.env.MONGO_URI;
    const req = makeReq('/api/notes');
    const res = makeRes();
    let nextCalled = false;
    readinessGate(req as any, res as any, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
  });

  it('passes through health paths even when mongo is disconnected', () => {
    const res = makeRes();
    let n = false;
    readinessGate(makeReq('/api/health') as any, res as any, () => { n = true; });
    expect(n).toBe(true);
  });

  it('passes through nested health paths', () => {
    const res = makeRes();
    let n = false;
    readinessGate(makeReq('/api/health/deep/anything') as any, res as any, () => { n = true; });
    expect(n).toBe(true);
  });

  it('returns 503 with Retry-After for non-health paths when disconnected', () => {
    const res = makeRes();
    let n = false;
    readinessGate(makeReq('/api/notes') as any, res as any, () => { n = true; });
    expect(n).toBe(false);
    expect(res.statusCode).toBe(503);
    expect(res.headers['Retry-After']).toBe('1');
    expect(res.headers['Connection']).toBe('close');
  });

  it('returns 503 while connecting (readyState=2)', () => {
    (mongoose.connection as any).readyState = 2;
    const res = makeRes();
    readinessGate(makeReq('/api/notes') as any, res as any, () => {});
    expect(res.statusCode).toBe(503);
  });

  it('passes through when connected (readyState=1)', () => {
    (mongoose.connection as any).readyState = 1;
    const res = makeRes();
    let n = false;
    readinessGate(makeReq('/api/notes') as any, res as any, () => { n = true; });
    expect(n).toBe(true);
  });
});
