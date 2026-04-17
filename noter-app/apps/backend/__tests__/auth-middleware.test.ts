import jwt from 'jsonwebtoken';
import { authMiddleware, getBearerTokenFromRequestLike, getCookieValueFromRequestLike, getUserIdFromDecodedToken } from '../src/middleware/authMiddleware';

describe('auth middleware helpers', () => {
  afterEach(() => {
    delete process.env.ALLOW_DEMO_TOKEN;
  });

  it('extracts bearer token from direct request headers', () => {
    const req = { headers: { authorization: 'Bearer abc.def.ghi' } };
    expect(getBearerTokenFromRequestLike(req)).toBe('abc.def.ghi');
  });

  it('extracts bearer token from wrapped raw headers', () => {
    const req = { raw: { headers: { authorization: 'bearer wrapped.token' } } };
    expect(getBearerTokenFromRequestLike(req)).toBe('wrapped.token');
  });

  it('extracts bearer token from header arrays and strips quotes', () => {
    const req = { headers: { authorization: ['Bearer "`quoted.token`"'] } };
    expect(getBearerTokenFromRequestLike(req)).toBe('quoted.token');
  });

  it('extracts cookie values from cookie headers', () => {
    const req = { headers: { cookie: 'foo=bar; noter_at=cookie-token; noter_rt=refresh-token' } };
    expect(getCookieValueFromRequestLike(req, 'noter_at')).toBe('cookie-token');
    expect(getCookieValueFromRequestLike(req, 'noter_rt')).toBe('refresh-token');
  });

  it('extracts userId from supported claims', () => {
    expect(getUserIdFromDecodedToken({ userId: 'u1' } as jwt.JwtPayload)).toBe('u1');
    expect(getUserIdFromDecodedToken({ id: 'u2' } as jwt.JwtPayload)).toBe('u2');
    expect(getUserIdFromDecodedToken({ _id: 'u3' } as jwt.JwtPayload)).toBe('u3');
    expect(getUserIdFromDecodedToken({ sub: 'u4' } as jwt.JwtPayload)).toBe('u4');
  });

  it('rejects demo-token when disabled', () => {
    process.env.ALLOW_DEMO_TOKEN = 'false';
    const req: any = { method: 'GET', headers: { authorization: 'Bearer demo-token' } };
    const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();
    authMiddleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rejects demo-token when no opt-in environment variable is set', () => {
    const req: any = { method: 'GET', headers: { authorization: 'Bearer demo-token' } };
    const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();
    authMiddleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('accepts demo-token when explicitly enabled', () => {
    process.env.ALLOW_DEMO_TOKEN = 'true';
    const req: any = { method: 'GET', headers: { authorization: 'Bearer demo-token' } };
    const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const next = jest.fn();
    authMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.user.userId).toBe('demo-user-id');
  });
});
