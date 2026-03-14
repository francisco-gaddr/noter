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
});

