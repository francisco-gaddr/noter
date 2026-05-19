import { conditionalGet, computeWeakEtag, matchesIfNoneMatch } from '../../src/middleware/etag';
import { EventEmitter } from 'node:events';

const makeReq = (method: string, headers: Record<string, string> = {}) => ({ method, headers });
const makeRes = () => {
  const r: any = new EventEmitter();
  r.statusCode = 200;
  r.headers = {} as Record<string, string>;
  r.body = undefined;
  r.ended = false;
  r.setHeader = (k: string, v: string) => { r.headers[k] = v; };
  r.status = (n: number) => { r.statusCode = n; return r; };
  r.json = (b: unknown) => { r.body = b; r.ended = true; return r; };
  r.end = () => { r.ended = true; return r; };
  return r;
};

describe('computeWeakEtag', () => {
  it('produces deterministic weak etags', () => {
    const a = computeWeakEtag('{"x":1}');
    const b = computeWeakEtag('{"x":1}');
    expect(a).toBe(b);
    expect(a.startsWith('W/"')).toBe(true);
  });

  it('produces different etags for different payloads', () => {
    expect(computeWeakEtag('{"x":1}')).not.toBe(computeWeakEtag('{"x":2}'));
  });
});

describe('matchesIfNoneMatch', () => {
  it('matches identical etag', () => {
    expect(matchesIfNoneMatch('W/"abc"', 'W/"abc"')).toBe(true);
  });

  it('matches inside a comma-separated list', () => {
    expect(matchesIfNoneMatch('W/"abc"', 'W/"xyz", W/"abc", W/"123"')).toBe(true);
  });

  it('matches wildcard *', () => {
    expect(matchesIfNoneMatch('W/"abc"', '*')).toBe(true);
  });

  it('no match for absent header', () => {
    expect(matchesIfNoneMatch('W/"abc"', undefined)).toBe(false);
  });
});

describe('conditionalGet middleware', () => {
  it('sets ETag + Cache-Control on JSON responses', () => {
    const mw = conditionalGet();
    const req = makeReq('GET');
    const res = makeRes();
    mw(req as any, res as any, () => {});
    res.json({ hello: 'world' });
    expect(res.headers['ETag']).toMatch(/^W\/"/);
    expect(res.headers['Cache-Control']).toBe('private, max-age=0, must-revalidate');
    expect(res.body).toEqual({ hello: 'world' });
  });

  it('returns 304 when If-None-Match matches', () => {
    const mw = conditionalGet();
    const body = { hello: 'world' };
    const expectedEtag = computeWeakEtag(JSON.stringify(body));
    const req = makeReq('GET', { 'if-none-match': expectedEtag });
    const res = makeRes();
    mw(req as any, res as any, () => {});
    res.json(body);
    expect(res.statusCode).toBe(304);
    expect(res.body).toBeUndefined();
  });

  it('does not 304 when If-None-Match differs', () => {
    const mw = conditionalGet();
    const req = makeReq('GET', { 'if-none-match': 'W/"stale"' });
    const res = makeRes();
    mw(req as any, res as any, () => {});
    res.json({ hello: 'world' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ hello: 'world' });
  });

  it('skips ETag for non-GET methods', () => {
    const mw = conditionalGet();
    const req = makeReq('POST');
    const res = makeRes();
    let nextCalled = false;
    mw(req as any, res as any, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
    // res.json wasn't patched → no ETag would be set
    expect(res.headers['ETag']).toBeUndefined();
  });

  it('does not ETag error responses', () => {
    const mw = conditionalGet();
    const req = makeReq('GET');
    const res = makeRes();
    mw(req as any, res as any, () => {});
    res.statusCode = 500;
    res.json({ message: 'oops' });
    expect(res.headers['ETag']).toBeUndefined();
  });

  it('respects custom Cache-Control', () => {
    const mw = conditionalGet({ cacheControl: 'public, max-age=60' });
    const req = makeReq('GET');
    const res = makeRes();
    mw(req as any, res as any, () => {});
    res.json({ x: 1 });
    expect(res.headers['Cache-Control']).toBe('public, max-age=60');
  });
});
