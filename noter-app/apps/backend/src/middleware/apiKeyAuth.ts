import type { Request, Response, NextFunction } from 'express';
import { createHash, timingSafeEqual, randomBytes } from 'node:crypto';
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
  // The secret is base64url and may itself contain '_', so split on the FIRST
  // separator only. The kid is fixed-charset [a-z0-9] (never '_'), so the first
  // '_' is unambiguously the kid/secret boundary.
  const sep = rest.indexOf('_');
  if (sep === -1) return null;
  const kid = rest.slice(0, sep);
  const secret = rest.slice(sep + 1);
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

// ---------------------------------------------------------------------------
// Key minting / management — lets users create API keys so external apps can
// integrate. The full token is returned ONCE on creation; only SHA-256(secret)
// is ever stored (symmetric with the verify path above).
// ---------------------------------------------------------------------------

/** 8-char [a-z0-9] key id (matches KID_PATTERN). */
const genKid = (): string => randomBytes(8).toString('hex').slice(0, 8);
/** 32-char base64url secret (matches SECRET_PATTERN). */
const genSecret = (): string => randomBytes(24).toString('base64url').slice(0, 32);

export const buildApiKeyToken = (kid: string, secret: string): string => `${PREFIX}${kid}_${secret}`;

export interface CreatedApiKey {
  token: string; // shown once — never stored
  kid: string;
  scopes: string[];
}

const apiKeyCollection = () => {
  const conn = mongoose.connection;
  if (!conn || conn.readyState !== 1 || !conn.db) return null;
  return conn.db.collection<ApiKeyRecord>(COLLECTION);
};

export const createApiKey = async (ownerUserId: string | undefined, scopes: string[] = []): Promise<CreatedApiKey> => {
  const col = apiKeyCollection();
  if (!col) throw new Error('Database unavailable');
  const kid = genKid();
  const secret = genSecret();
  await col.insertOne({ kid, hash: sha256(secret), ownerUserId, scopes, createdAt: new Date(), revokedAt: null });
  return { token: buildApiKeyToken(kid, secret), kid, scopes };
};

export type ApiKeySummary = Pick<ApiKeyRecord, 'kid' | 'scopes' | 'createdAt' | 'lastSeenAt' | 'revokedAt'>;

export const listApiKeys = async (ownerUserId?: string): Promise<ApiKeySummary[]> => {
  const col = apiKeyCollection();
  if (!col) return [];
  return col
    .find({ ownerUserId }, { projection: { _id: 0, hash: 0, ownerUserId: 0 } })
    .toArray() as unknown as Promise<ApiKeySummary[]>;
};

export const revokeApiKey = async (kid: string, ownerUserId?: string): Promise<boolean> => {
  const col = apiKeyCollection();
  if (!col) return false;
  const res = await col.updateOne({ kid, ownerUserId, revokedAt: null }, { $set: { revokedAt: new Date() } });
  return res.modifiedCount > 0;
};

// Test-only exports
export const _parseToken = parseToken;
export const _sha256 = sha256;
export const _PREFIX = PREFIX;
export const _genKid = genKid;
export const _genSecret = genSecret;
