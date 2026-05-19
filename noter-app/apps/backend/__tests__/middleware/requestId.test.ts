import { requestIdMiddleware, getRequestId } from '../../src/middleware/requestId';

const makeReq = (headers: Record<string, string | string[]> = {}) => ({ headers, requestId: undefined as string | undefined });
const makeRes = () => {
  const h: Record<string, string> = {};
  return {
    headers: h,
    setHeader: (k: string, v: string) => { h[k] = v; },
  };
};

describe('requestIdMiddleware', () => {
  it('generates a fresh id when no inbound header present', () => {
    const req = makeReq();
    const res = makeRes();
    requestIdMiddleware(req as any, res as any, () => {});
    expect(typeof req.requestId).toBe('string');
    expect(req.requestId).toMatch(/^[a-f0-9]{16}$/);
    expect(res.headers['X-Request-ID']).toBe(req.requestId);
  });

  it('echoes a valid inbound x-request-id', () => {
    const req = makeReq({ 'x-request-id': 'abc-123_ok' });
    const res = makeRes();
    requestIdMiddleware(req as any, res as any, () => {});
    expect(req.requestId).toBe('abc-123_ok');
    expect(res.headers['X-Request-ID']).toBe('abc-123_ok');
  });

  it('falls back to x-correlation-id, then request-id', () => {
    const req = makeReq({ 'x-correlation-id': 'corr-1' });
    const res = makeRes();
    requestIdMiddleware(req as any, res as any, () => {});
    expect(req.requestId).toBe('corr-1');
  });

  it('rejects inbound ids that contain log-poisoning characters', () => {
    const req = makeReq({ 'x-request-id': 'abc\ninjected: yes' });
    const res = makeRes();
    requestIdMiddleware(req as any, res as any, () => {});
    expect(req.requestId).not.toBe('abc\ninjected: yes');
    expect(req.requestId).toMatch(/^[a-f0-9]{16}$/);
  });

  it('rejects inbound ids longer than 128 chars', () => {
    const long = 'a'.repeat(200);
    const req = makeReq({ 'x-request-id': long });
    const res = makeRes();
    requestIdMiddleware(req as any, res as any, () => {});
    expect(req.requestId).not.toBe(long);
  });

  it('getRequestId returns undefined when middleware did not run', () => {
    const req = {} as any;
    expect(getRequestId(req)).toBeUndefined();
  });
});
