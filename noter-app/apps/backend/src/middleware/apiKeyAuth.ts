import type { Request, Response, NextFunction } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import mongoose from 'mongoose';
import { UnauthorizedError, ForbiddenError } from '../utils/httpErrors';
import logger from '../utils/logger';

/**
 * API-key authentication.
 *
 * Format: `nk_<kid>_<secret>` where:
 *   - prefix `nk_` lets us spot-and-scrub leaked keys in logs/dumps
 *   - `kid` is a stable identifier (base32, 8 chars)
 *   - `secret` is 32 base64url chars (≈192 bits of entropy)
 *
 * Storage in `_api_keys` collection:
 *   { kid, hash, ownerUserId, scopes: string[], createdAt, lastSeenAt, revokedAt? }
 *   - `hash` is SHA-256(secret) — we never store the secret. timingSafeEqual
 *     comparison is on the hash.
 *
 * Auth flow:
 *   1. Extract from `Authorization: ApiKey <token>` OR `X-Api-Key: <token>` header.
 *   2. Parse + validate format.
 *   3. Look up by kid (indexed).
 *   4. timingSafeEqual against stored hash.
 *   5. Reject if `revokedAt` is set.
 *   6. Optionally check requested scopes against key's allowed scopes.
 *   7. Lazy update `lastSeenAt` (fire-and-forget so the auth check is fast).
 */

const COLLECTION = '_api_keys';
const PREFIX = 'nk_';
const KID_PATTERN = /^[a-z0-9]{8}$/;
const SECRET_PATTERN = /^[A-Za-z0-9_-]{32}$/;

const sha256 = (input: string): string => createHash('sha256').update(input).digest('hex');

const parseToken = (raw: string): { kid: string; secret: string } | null => {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 128) return null;
  if (!raw.startsWith(PREFIX)) return null;
  const rest = raw.slice(PREFIX.length);
  const parts = rest.split('_');
  if (parts.length !== 2) return null;
  const [kid, secret] = parts;
  if (!KID_PATTERN.test(kid) || !SECRET_PATTERN.test(secret)) return null;
  return { kid, secret };
};

const extractToken = (req: Request): string | null => {
  const auth = req.headers['authorization'];
  if (typeof auth === 'string' && auth.toLowerCase().startsWith('apikey ')) {
    return auth.slice(7).trim();
  }
  const headerX = req.headers['x-api-key'];
  if (typeof headerX === 'string') return headerX.trim();
  return null;
};

interface ApiKeyRecord {
  kid: string;
  hash: string;
  ownerUserId?: string;
  scopes: string[];
  createdAt: Date;
  lastSeenAt?: Date;
  revokedAt?: Date | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    // eslint-disable-next-line @typescript-eslint/no-empty-interface
    interface Request {
      apiKey?: { kid: string; ownerUserId?: string; scopes: string[] };
    }
  }
}

const recentTouches = new Map<string, number>();
const TOUCH_THROTTLE_MS = 60_000;

const touchLastSeen = async (kid: string): Promise<void> => {
  const now = Date.now();
  const last = recentTouches.get(kid);
  if (last && now - last < TOUCH_THROTTLE_MS) return;
  recentTouches.set(kid, now);
  if (recentTouches.size > 256) {
    for (const [k, t] of recentTouches) if (now - t > TOUCH_THROTTLE_MS) recentTouches.delete(k);
  }
  try {
    const conn = mongoose.connection;
    if (!conn || conn.readyState !== 1 || !conn.db) return;
    await conn.db.collection<ApiKeyRecord>(COLLECTION).updateOne({ kid }, { $set: { lastSeenAt: new Date() } });
  } catch (err) {
    logger.warn('apiKey: touch lastSeenAt failed', { kid, error: (err as Error)?.message });
  }
};

/**
 * Express middleware. Requires a valid API key on each request.
 * Optional `requiredScopes` enforces the key has at least one of them
 * (OR semantics). Pass an empty array to skip scope checking.
 */
export const apiKeyAuth = (requiredScopes: string[] = []) => {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const raw = extractToken(req);
    if (!raw) return next(new UnauthorizedError('API key required', { code: 'API_KEY_MISSING' }));
    const parsed = parseToken(raw);
    if (!parsed) return next(new UnauthorizedError('API key malformed', { code: 'API_KEY_MALFORMED' }));

    const conn = mongoose.connection;
    if (!conn || conn.readyState !== 1 || !conn.db) {
      return next(new UnauthorizedError('API key auth temporarily unavailable', { code: 'API_KEY_UNAVAILABLE' }));
    }

    const record = await conn.db.collection<ApiKeyRecord>(COLLECTION).findOne({ kid: parsed.kid });
    if (!record) return next(new UnauthorizedError('API key not found', { code: 'API_KEY_NOT_FOUND' }));
    if (record.revokedAt) return next(new UnauthorizedError('API key revoked', { code: 'API_KEY_REVOKED' }));

    const expectedHash = Buffer.from(record.hash, 'hex');
    const actualHash = Buffer.from(sha256(parsed.secret), 'hex');
    if (expectedHash.length !== actualHash.length || !timingSafeEqual(expectedHash, actualHash)) {
      return next(new UnauthorizedError('API key invalid', { code: 'API_KEY_INVALID' }));
    }

    if (requiredScopes.length > 0) {
      const has = record.scopes.some((s) => requiredScopes.includes(s));
      if (!has) {
        return next(new ForbiddenError('API key missing required scope', {
          code: 'API_KEY_MISSING_SCOPE',
          details: { required: requiredScopes, has: record.scopes },
        }));
      }
    }

    req.apiKey = { kid: record.kid, ownerUserId: record.ownerUserId, scopes: record.scopes };
    void touchLastSeen(record.kid);
    next();
  };
};

// Test-only exports
export const _parseToken = parseToken;
export const _sha256 = sha256;
export const _PREFIX = PREFIX;
