import { blockSuspiciousRequestPatterns, enforceJsonApiRequests } from '../src/middleware/requestSecurity';

const createRes = () => {
  const res: any = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return res;
};

describe('request security middleware', () => {
  it('blocks non-json body for api write requests', () => {
    const req: any = {
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'content-length': '10' },
      is: jest.fn().mockReturnValue(false),
    };
    const res = createRes();
    const next = jest.fn();
    enforceJsonApiRequests(req, res, next);
    expect(res.status).toHaveBeenCalledWith(415);
    expect(next).not.toHaveBeenCalled();
  });

  it('allows safe requests through suspicious-pattern filter', () => {
    const req: any = {
      path: '/api/notes',
      originalUrl: '/api/notes?page=1',
      query: { page: '1' },
      body: { title: 'x' },
      params: {},
    };
    const res = createRes();
    const next = jest.fn();
    blockSuspiciousRequestPatterns(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('blocks dangerous url patterns and nosql keys', () => {
    const urlReq: any = {
      path: '/api/notes',
      originalUrl: '/api/notes?$where=this.password',
      query: {},
      body: {},
      params: {},
    };
    const urlRes = createRes();
    const urlNext = jest.fn();
    blockSuspiciousRequestPatterns(urlReq, urlRes, urlNext);
    expect(urlRes.status).toHaveBeenCalledWith(400);
    expect(urlNext).not.toHaveBeenCalled();

    const bodyReq: any = {
      path: '/api/tasks',
      originalUrl: '/api/tasks',
      query: {},
      body: { updates: { $ne: 'x' } },
      params: {},
    };
    const bodyRes = createRes();
    const bodyNext = jest.fn();
    blockSuspiciousRequestPatterns(bodyReq, bodyRes, bodyNext);
    expect(bodyRes.status).toHaveBeenCalledWith(400);
    expect(bodyNext).not.toHaveBeenCalled();
  });

  it('blocks encoded injection probes and overly long urls', () => {
    const encodedReq: any = {
      path: '/api/notes',
      originalUrl: '/api/notes?search=%24where%3Dthis.password',
      query: {},
      body: {},
      params: {},
    };
    const encodedRes = createRes();
    const encodedNext = jest.fn();
    blockSuspiciousRequestPatterns(encodedReq, encodedRes, encodedNext);
    expect(encodedRes.status).toHaveBeenCalledWith(400);
    expect(encodedNext).not.toHaveBeenCalled();

    const longReq: any = {
      path: '/api/notes',
      originalUrl: `/api/${'a'.repeat(5000)}`,
      query: {},
      body: {},
      params: {},
    };
    expect(longReq.originalUrl.length).toBeGreaterThan(2048);
    const longRes = createRes();
    const longNext = jest.fn();
    blockSuspiciousRequestPatterns(longReq, longRes, longNext);
    expect(longRes.status).toHaveBeenCalledWith(414);
    expect(longNext).not.toHaveBeenCalled();
  });

  it('blocks prototype pollution payloads hidden in nested arrays', () => {
    const req: any = {
      path: '/api/tasks',
      originalUrl: '/api/tasks',
      query: {},
      body: JSON.parse('{"updates":[{"safe":true},{"constructor":{"prototype":{"polluted":true}}}]}'),
      params: {},
    };
    const res = createRes();
    const next = jest.fn();
    blockSuspiciousRequestPatterns(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });
});

