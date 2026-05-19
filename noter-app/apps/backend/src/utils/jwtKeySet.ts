import jwt, { type SignOptions, type JwtPayload } from 'jsonwebtoken';
import logger from './logger';

/**
 * Multi-key JWT signer/verifier with `kid` header support.
 *
 * Why rotation matters: a leaked HMAC secret invalidates every token
 * signed with it. With a single static secret, the fix is "rotate the
 * env var" — which forces every active user to log in again. With
 * `kid`-based rotation we can introduce a new key, sign new tokens with
 * it, and keep accepting old-key tokens until they naturally expire.
 *
 * Configuration:
 *   - `JWT_KEYS` env: JSON array of `[{ kid, secret, status }]`. Status is
 *     'current' (signs new tokens), 'previous' (verifies but doesn't sign),
 *     or 'revoked' (refuse).
 *   - Single secret via legacy `JWT_SECRET` is still accepted and treated
 *     as `{ kid: 'legacy', secret: <value>, status: 'current' }`.
 *
 * Operations:
 *   - `signJwt(payload)` always signs with the current key.
 *   - `verifyJwt(token)` reads `kid` from the header, looks up the matching
 *     key, and verifies. Falls back to trying every non-revoked key if
 *     `kid` is missing (legacy compat).
 */

interface KeyEntry {
  kid: string;
  secret: string;
  status: 'current' | 'previous' | 'revoked';
}

let cachedKeys: KeyEntry[] | null = null;

const parseKeys = (raw: string | undefined): KeyEntry[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((k): k is KeyEntry => {
        return !!k && typeof (k as KeyEntry).kid === 'string'
          && typeof (k as KeyEntry).secret === 'string'
          && (k as KeyEntry).secret.length >= 16
          && ((k as KeyEntry).status === 'current' || (k as KeyEntry).status === 'previous' || (k as KeyEntry).status === 'revoked');
      })
      .map((k) => ({ kid: k.kid, secret: k.secret, status: k.status }));
  } catch (err) {
    logger.warn('jwtKeySet: failed to parse JWT_KEYS', { error: (err as Error)?.message });
    return [];
  }
};

const resolveKeys = (): KeyEntry[] => {
  if (cachedKeys) return cachedKeys;
  const fromEnv = parseKeys(process.env.JWT_KEYS);
  if (fromEnv.length > 0) {
    // Validate that there's exactly one 'current'.
    const currents = fromEnv.filter((k) => k.status === 'current');
    if (currents.length === 0) {
      logger.warn('jwtKeySet: no current key found in JWT_KEYS');
    } else if (currents.length > 1) {
      logger.warn('jwtKeySet: multiple current keys, using first', { kids: currents.map((c) => c.kid) });
    }
    cachedKeys = fromEnv;
    return cachedKeys;
  }
  // Legacy compat — fall back to JWT_SECRET as a single 'current' key.
  const legacySecret = process.env.JWT_SECRET;
  cachedKeys = legacySecret
    ? [{ kid: 'legacy', secret: legacySecret, status: 'current' }]
    : [];
  return cachedKeys;
};

export const getCurrentKey = (): KeyEntry | null => {
  return resolveKeys().find((k) => k.status === 'current') ?? null;
};

export const getKeyById = (kid: string): KeyEntry | null => {
  return resolveKeys().find((k) => k.kid === kid) ?? null;
};

export const listActiveKids = (): string[] =>
  resolveKeys().filter((k) => k.status !== 'revoked').map((k) => k.kid);

/**
 * Sign with the current key. Throws if no current key is configured.
 */
export const signJwt = (payload: string | object | Buffer, options: SignOptions = {}): string => {
  const current = getCurrentKey();
  if (!current) throw new Error('jwtKeySet: no current key configured');
  return jwt.sign(payload, current.secret, {
    ...options,
    keyid: current.kid,
  });
};

interface VerifyResult {
  payload: JwtPayload | string;
  kid: string;
}

/**
 * Verify with the key matching the token's `kid` header. Falls back to
 * trying each non-revoked key if `kid` is missing or unknown.
 */
export const verifyJwt = (token: string, options: jwt.VerifyOptions = {}): VerifyResult => {
  const keys = resolveKeys();
  if (keys.length === 0) throw new Error('jwtKeySet: no keys configured');

  // Decode header without verifying — gives us the kid (if any).
  const decoded = jwt.decode(token, { complete: true });
  const headerKid = decoded && typeof decoded === 'object' && decoded.header && typeof decoded.header.kid === 'string'
    ? decoded.header.kid
    : undefined;

  if (headerKid) {
    const key = keys.find((k) => k.kid === headerKid);
    if (!key) throw new Error(`jwtKeySet: unknown kid ${headerKid}`);
    if (key.status === 'revoked') throw new Error(`jwtKeySet: kid ${headerKid} is revoked`);
    const payload = jwt.verify(token, key.secret, options) as JwtPayload | string;
    return { payload, kid: key.kid };
  }

  // No kid → try each non-revoked key. We return as soon as one verifies.
  let lastErr: Error | null = null;
  for (const key of keys) {
    if (key.status === 'revoked') continue;
    try {
      const payload = jwt.verify(token, key.secret, options) as JwtPayload | string;
      return { payload, kid: key.kid };
    } catch (err) {
      lastErr = err as Error;
    }
  }
  throw lastErr ?? new Error('jwtKeySet: verification failed');
};

export const _resetKeyCache = (): void => { cachedKeys = null; };
export const _setKeysForTest = (keys: KeyEntry[]): void => { cachedKeys = keys; };
