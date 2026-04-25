import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import winston from 'winston';
import User from '../models/User';
import cache from '../services/cache';
import { getJwtSecret, getJwtVerifyOptions, isDemoTokenEnabled } from '../utils/security';

export interface AuthRequest extends Request {
  user?: { userId: string };
  requestId?: string;
  log?: winston.Logger;
}

type DecodedToken = jwt.JwtPayload & {
  userId?: string;
  id?: string;
  _id?: string;
  sub?: string;
  tokenVersion?: number;
};

const getCachedTokenVersion = async (userId: string): Promise<number | null> => {
  const cacheKey = `auth:token-version:${userId}`;
  const cached = await cache.get<number>(cacheKey);
  if (typeof cached === 'number' && Number.isFinite(cached)) return cached;
  const user = await User.findById(userId).select('tokenVersion').lean<{ tokenVersion?: number }>();
  const tokenVersion = typeof user?.tokenVersion === 'number' ? user.tokenVersion : 1;
  await cache.set(cacheKey, tokenVersion, 5);
  return tokenVersion;
};

export const getBearerTokenFromRequestLike = (reqLike: any): string | undefined => {
  const unwrapWrappedToken = (value: string) => {
    let current = value.trim();
    while (current.length >= 2) {
      const first = current[0];
      const last = current[current.length - 1];
      const isWrapped =
        (first === '"' && last === '"')
        || (first === "'" && last === "'")
        || (first === '`' && last === '`');
      if (!isWrapped) break;
      current = current.slice(1, -1).trim();
    }
    return current;
  };

  const pick = (value: unknown): string | undefined => {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
      const first = value.find((item) => typeof item === 'string');
      return typeof first === 'string' ? first : undefined;
    }
    return undefined;
  };

  const rawHeader =
    pick(reqLike?.header?.('Authorization')) ??
    pick(reqLike?.header?.('authorization')) ??
    pick(reqLike?.headers?.authorization) ??
    pick(reqLike?.headers?.Authorization) ??
    pick(reqLike?.raw?.headers?.authorization) ??
    pick(reqLike?.raw?.headers?.Authorization) ??
    pick(reqLike?.req?.headers?.authorization) ??
    pick(reqLike?.req?.headers?.Authorization) ??
    pick(reqLike?.request?.headers?.authorization) ??
    pick(reqLike?.request?.headers?.Authorization);

  if (!rawHeader) return undefined;
  const normalized = unwrapWrappedToken(rawHeader.trim().replace(/^Bearer\s+/i, '').trim());
  return normalized || undefined;
};

const getCookieHeaderFromRequestLike = (reqLike: any): string | undefined => {
  const pick = (value: unknown): string | undefined => {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
      const first = value.find((item) => typeof item === 'string');
      return typeof first === 'string' ? first : undefined;
    }
    return undefined;
  };

  return (
    pick(reqLike?.headers?.cookie) ??
    pick(reqLike?.headers?.Cookie) ??
    pick(reqLike?.raw?.headers?.cookie) ??
    pick(reqLike?.req?.headers?.cookie) ??
    pick(reqLike?.request?.headers?.cookie)
  );
};

export const getCookieValueFromRequestLike = (reqLike: any, cookieName: string): string | undefined => {
  const header = getCookieHeaderFromRequestLike(reqLike);
  if (!header || !cookieName) return undefined;
  const pairs = header.split(';');
  for (const pair of pairs) {
    const [rawKey, ...rest] = pair.split('=');
    if (rawKey?.trim() !== cookieName) continue;
    const rawValue = rest.join('=').trim();
    if (!rawValue) return undefined;
    try {
      return decodeURIComponent(rawValue);
    } catch {
      return rawValue;
    }
  }
  return undefined;
};

export const getUserIdFromDecodedToken = (decoded: string | jwt.JwtPayload): string | undefined => {
  if (typeof decoded === 'string') return undefined;
  const payload = decoded as DecodedToken;
  const candidate = payload.userId ?? payload.id ?? payload._id ?? payload.sub;
  if (typeof candidate !== 'string') return undefined;
  const trimmed = candidate.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export const authMiddleware = async (req: AuthRequest, res: Response, next: NextFunction) => {
  if (req.method === 'OPTIONS') {
    return next();
  }

  const token = getBearerTokenFromRequestLike(req) || getCookieValueFromRequestLike(req, 'noter_at');
  
  if (!token) {
    return res.status(401).json({ message: 'No token, authorization denied' });
  }

  if (token === 'demo-token') {
    if (isDemoTokenEnabled()) {
      req.user = { userId: 'demo-user-id' };
      return next();
    }
    return res.status(401).json({ message: 'Token is not valid' });
  }

  try {
    const decoded = jwt.verify(token, getJwtSecret(), getJwtVerifyOptions());
    const userId = getUserIdFromDecodedToken(decoded);
    if (!userId) {
      return res.status(401).json({ message: 'Token is not valid' });
    }
    const payload = decoded as DecodedToken;
    const tokenVersion = typeof payload.tokenVersion === 'number' ? payload.tokenVersion : 1;
    const currentTokenVersion = await getCachedTokenVersion(userId);
    if (currentTokenVersion !== null && tokenVersion !== currentTokenVersion) {
      return res.status(401).json({ message: 'Token is not valid' });
    }
    req.user = { userId };
    next();
  } catch (err) {
    res.status(401).json({ message: 'Token is not valid' });
  }
};
