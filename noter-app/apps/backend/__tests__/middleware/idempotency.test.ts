import { idempotency, _clearIdempotencyCache, _idempotencyCacheSize } from '../../src/middleware/idempotency';

const makeReq = (method: string, body: unknown, headers: Record<string, string> = {}, userId?: string) => ({
  method, body, headers, user: userId ? { userId } : undefined,
});
const makeRes = () => {
  const r: any = {};
  r.statusCode = 200;
  r.headers = {} as Record<string, string>;
  r.ended = false;
  r.setHeader = (k: string, v: string) => { r.headers[k] = v; };
  r.status = (n: number) => { r.statusCode = n; return r; };
  r.json = (b: unknown) => { r.body = b; r.ended = true; return r; };
  return r;
};

const run = (req: any, res: any) => new Promise<void>((resolve) => {
  const mw = idempotency();
  mw(req as any, res as any, () => resolve());
  if (res.ended) resolve();
});

describe('idempotency middleware', () => {
  beforeEach(() => _clearIdempotencyCache());

  it('passes through non-mutating methods', async () => {
    const req = makeReq('GET', undefined, { 'idempotency-key': 'abcd1234' }, 'u1');
    const res = makeRes();
    let nextCalled = false;
    idempotency()(req as any, res as any, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
  });

  it('passes through when no Idempotency-Key header', async () => {
    const req = makeReq('POST', { x: 1 }, {}, 'u1');
    const res = makeRes();
    let nextCalled = false;
    idempotency()(req as any, res as any, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
  });

  it('rejects invalid (too-short) key as if absent', async () => {
    const req = makeReq('POST', { x: 1 }, { 'idempotency-key': 'short' }, 'u1');
    const res = makeRes();
    let nextCalled = false;
    idempotency()(req as any, res as any, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
  });

  it('caches successful response and replays on duplicate', async () => {
    const key = 'idem-abc-1234567890';
    const req1 = makeReq('POST', { x: 1 }, { 'idempotency-key': key }, 'u1');
    const res1 = makeRes();
    await run(req1, res1);
    res1.json({ created: true, id: 'n1' });

    const req2 = makeReq('POST', { x: 1 }, { 'idempotency-key': key }, 'u1');
    const res2 = makeRes();
    await run(req2, res2);
    expect(res2.body).toEqual({ created: true, id: 'n1' });
    expect(res2.headers['Idempotency-Replayed']).toBe('true');
  });

  it('returns 409 when same key used with different body', async () => {
    const key = 'idem-conflict-key-1234';
    const req1 = makeReq('POST', { x: 1 }, { 'idempotency-key': key }, 'u1');
    const res1 = makeRes();
    await run(req1, res1);
    res1.json({ ok: true });

    const req2 = makeReq('POST', { x: 2 }, { 'idempotency-key': key }, 'u1');
    const res2 = makeRes();
    await run(req2, res2);
    expect(res2.statusCode).toBe(409);
    expect(res2.body?.extensions?.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('scopes keys by userId — same key from different users does not collide', async () => {
    const key = 'idem-cross-user-12345';
    const req1 = makeReq('POST', { x: 1 }, { 'idempotency-key': key }, 'alice');
    const res1 = makeRes();
    await run(req1, res1);
    res1.json({ user: 'alice' });

    const req2 = makeReq('POST', { x: 999 }, { 'idempotency-key': key }, 'bob');
    const res2 = makeRes();
    await run(req2, res2);
    // bob's request goes through (no conflict) because his key is scoped separately.
    expect(res2.statusCode).toBe(200);
    expect(res2.headers['Idempotency-Replayed']).toBeUndefined();
  });

  it('does not cache error responses (>=400)', async () => {
    const key = 'idem-error-key-1234567';
    const req1 = makeReq('POST', { x: 1 }, { 'idempotency-key': key }, 'u1');
    const res1 = makeRes();
    await run(req1, res1);
    res1.status(500).json({ message: 'boom' });

    expect(_idempotencyCacheSize()).toBe(0);

    const req2 = makeReq('POST', { x: 1 }, { 'idempotency-key': key }, 'u1');
    const res2 = makeRes();
    let next2Called = false;
    idempotency()(req2 as any, res2 as any, () => { next2Called = true; });
    expect(next2Called).toBe(true); // not replayed
  });
});
