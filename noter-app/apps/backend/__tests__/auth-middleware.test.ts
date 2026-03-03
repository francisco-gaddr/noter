import jwt from 'jsonwebtoken';
import { getBearerTokenFromRequestLike, getUserIdFromDecodedToken } from '../src/middleware/authMiddleware';

describe('auth middleware helpers', () => {
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

  it('extracts userId from supported claims', () => {
    expect(getUserIdFromDecodedToken({ userId: 'u1' } as jwt.JwtPayload)).toBe('u1');
    expect(getUserIdFromDecodedToken({ id: 'u2' } as jwt.JwtPayload)).toBe('u2');
    expect(getUserIdFromDecodedToken({ _id: 'u3' } as jwt.JwtPayload)).toBe('u3');
    expect(getUserIdFromDecodedToken({ sub: 'u4' } as jwt.JwtPayload)).toBe('u4');
  });
});
