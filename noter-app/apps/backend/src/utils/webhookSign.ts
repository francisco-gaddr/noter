import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * HMAC-SHA256 webhook signing in the Stripe / Slack idiom:
 *   `t=<unix-ts>,v1=<hex-hmac>`
 *
 * Why this shape:
 *   - Timestamp prefixes the signing material, so replaying a captured
 *     signature outside the freshness window fails.
 *   - Version tag (`v1`) lets us rotate the algorithm later without
 *     breaking existing integrations.
 *   - Comma separation (no JSON, no whitespace) is robust to header
 *     handling differences across HTTP libraries.
 *
 * Verify is constant-time on the hex bytes to avoid timing oracles.
 */

const VERSION = 'v1';
const DEFAULT_TOLERANCE_SECONDS = 5 * 60;

const computeHmac = (secret: string, signedPayload: string): string => {
  return createHmac('sha256', secret).update(signedPayload).digest('hex');
};

export interface SignOptions {
  timestamp?: number; // seconds since epoch; defaults to now
}

export const signPayload = (secret: string, body: string, opts: SignOptions = {}): string => {
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new Error('secret required');
  }
  if (typeof body !== 'string') {
    throw new Error('body must be a string (pre-serialise JSON before signing)');
  }
  const ts = Math.floor(opts.timestamp ?? Date.now() / 1000);
  const signed = `${ts}.${body}`;
  const mac = computeHmac(secret, signed);
  return `t=${ts},${VERSION}=${mac}`;
};

export interface VerifyOptions {
  toleranceSeconds?: number;
  now?: () => number;
}

export type VerifyResult =
  | { ok: true; timestamp: number }
  | { ok: false; reason: 'missing' | 'malformed' | 'unsupported-version' | 'stale' | 'invalid-signature' };

const parseHeader = (header: string): { t: number | null; v1: string | null } => {
  let t: number | null = null;
  let v1: string | null = null;
  for (const part of header.split(',')) {
    const [k, ...rest] = part.split('=');
    const v = rest.join('=');
    if (!k || !v) continue;
    if (k.trim() === 't') {
      const n = Number(v.trim());
      if (Number.isFinite(n)) t = n;
    } else if (k.trim() === 'v1') {
      v1 = v.trim();
    }
  }
  return { t, v1 };
};

export const verifyWebhookSignature = (
  secret: string,
  body: string,
  signatureHeader: string | string[] | undefined,
  opts: VerifyOptions = {},
): VerifyResult => {
  if (!signatureHeader) return { ok: false, reason: 'missing' };
  const header = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
  if (typeof header !== 'string' || header.length === 0) return { ok: false, reason: 'missing' };
  const { t, v1 } = parseHeader(header);
  if (t === null || v1 === null) return { ok: false, reason: 'malformed' };

  const tolerance = opts.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  const now = (opts.now ?? (() => Math.floor(Date.now() / 1000)))();
  if (Math.abs(now - t) > tolerance) return { ok: false, reason: 'stale' };

  const expected = computeHmac(secret, `${t}.${body}`);
  // Constant-time compare. Both strings must be the same length for
  // timingSafeEqual to work; pad with zeros if not (still safe — comparison
  // simply returns false on length mismatch via the explicit guard).
  if (expected.length !== v1.length) return { ok: false, reason: 'invalid-signature' };
  const expectedBuf = Buffer.from(expected, 'hex');
  const actualBuf = Buffer.from(v1, 'hex');
  if (expectedBuf.length !== actualBuf.length) return { ok: false, reason: 'invalid-signature' };
  if (!timingSafeEqual(expectedBuf, actualBuf)) return { ok: false, reason: 'invalid-signature' };

  return { ok: true, timestamp: t };
};
