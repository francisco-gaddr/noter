import { serverTimingMiddleware, recordTiming, timeSection } from '../../src/middleware/serverTiming';
import { EventEmitter } from 'node:events';

type FakeRes = EventEmitter & {
  headers: Record<string, string>;
  setHeader: (k: string, v: string) => void;
  headersSent: boolean;
  end: (...args: unknown[]) => unknown;
  originalEndCalled: boolean;
};

const makeRes = (): FakeRes => {
  const ee = new EventEmitter() as unknown as FakeRes;
  ee.headers = {};
  ee.headersSent = false;
  ee.originalEndCalled = false;
  ee.setHeader = (k, v) => { ee.headers[k] = v; };
  ee.end = () => { ee.originalEndCalled = true; return undefined; };
  return ee;
};

describe('serverTiming middleware', () => {
  it('emits Server-Timing header on end() with total', () => {
    const req: any = {};
    const res = makeRes();
    serverTimingMiddleware(req as any, res as any, () => {});
    res.end();
    expect(res.headers['Server-Timing']).toBeDefined();
    expect(res.headers['Server-Timing']).toMatch(/total;dur=\d/);
  });

  it('includes recordTiming segments', () => {
    const req: any = {};
    const res = makeRes();
    serverTimingMiddleware(req as any, res as any, () => {});
    recordTiming(req as any, 'db_query', 12.5, 'mongo find');
    recordTiming(req as any, 'cache_miss', 0.1);
    res.end();
    const header = res.headers['Server-Timing'];
    expect(header).toContain('db_query;dur=12.5');
    expect(header).toContain('cache_miss;dur=0.1');
    expect(header).toContain('desc="mongo find"');
  });

  it('sanitises segment names that contain unsafe characters', () => {
    const req: any = {};
    const res = makeRes();
    serverTimingMiddleware(req as any, res as any, () => {});
    recordTiming(req as any, 'name with spaces;and!chars', 1);
    res.end();
    expect(res.headers['Server-Timing']).toMatch(/name_with_spaces_and_chars;dur=1/);
  });

  it('timeSection records its block duration', async () => {
    const req: any = {};
    const res = makeRes();
    serverTimingMiddleware(req as any, res as any, () => {});
    await timeSection(req as any, 'slow_block', async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    res.end();
    expect(res.headers['Server-Timing']).toMatch(/slow_block;dur=\d+/);
  });
});
