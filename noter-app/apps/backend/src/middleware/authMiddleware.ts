import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { getJwtSecret, getJwtVerifyOptions, isDemoTokenEnabled } from '../utils/security';

export type TenantClaims = {
  orgId?: string;
  roles?: string[];
  scopes?: string[];
  plan?: string;
};

export interface AuthRequest extends Request {
  user?: { userId: string };
  tenant?: TenantClaims;
}

type DecodedToken = jwt.JwtPayload & {
  userId?: string;
  id?: string;
  _id?: string;
  sub?: string;
  orgId?: string;
  org_id?: string;
  tenantId?: string;
  tenant_id?: string;
  roles?: unknown;
  scopes?: unknown;
  scope?: unknown;
  plan?: string;
};

const normaliseStringList = (value: unknown): string[] | undefined => {
  if (!value) return undefined;
  if (Array.isArray(value)) {
    const filtered = value.filter((v) => typeof v === 'string' && v.length > 0) as string[];
    return filtered.length ? filtered : undefined;
  }
  if (typeof value === 'string') {
    const parts = value.split(/[\s,]+/).map((v) => v.trim()).filter((v) => v.length > 0);
    return parts.length ? parts : undefined;
  }
  return undefined;
};

export const extractTenantClaims = (decoded: string | jwt.JwtPayload): TenantClaims => {
  if (typeof decoded === 'string') return {};
  const payload = decoded as DecodedToken;
  const orgIdRaw = payload.orgId ?? payload.org_id ?? payload.tenantId ?? payload.tenant_id;
  return {
    orgId: typeof orgIdRaw === 'string' && orgIdRaw.trim().length ? orgIdRaw.trim() : undefined,
    roles: normaliseStringList(payload.roles),
    scopes: normaliseStringList(payload.scopes ?? payload.scope),
    plan: typeof payload.plan === 'string' && payload.plan.length ? payload.plan : undefined,
  };
};

export const getBearerTokenFromRequestLike = (reqLike: any): string | undefined => {
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
  const normalized = rawHeader.trim().replace(/^Bearer\s+/i, '').trim().replace(/^[`'"]+|[`'"]+$/g, '').trim();
  return normalized || undefined;
};

export const getUserIdFromDecodedToken = (decoded: string | jwt.JwtPayload): string | undefined => {
  if (typeof decoded === 'string') return undefined;
  const payload = decoded as DecodedToken;
  const candidate = payload.userId ?? payload.id ?? payload._id ?? payload.sub;
  if (typeof candidate !== 'string') return undefined;
  const trimmed = candidate.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export const authMiddleware = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (req.method === 'OPTIONS') {
    return next();
  }

  const token = getBearerTokenFromRequestLike(req);
  
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
    req.user = { userId };
    req.tenant = extractTenantClaims(decoded);
    next();
  } catch (err) {
    res.status(401).json({ message: 'Token is not valid' });
  }
};
