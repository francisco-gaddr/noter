import { createHash, createPrivateKey, sign as signCallback, generateKeyPairSync } from 'node:crypto';
import logger from '../utils/logger';

/**
 * Web Push notification sender — VAPID-signed JWTs in front of a tiny
 * `fetch` to the browser's push endpoint.
 *
 * Why we roll the JWT signing here instead of pulling in `web-push`:
 *   - `web-push` adds a transitive dep tree we don't need on the
 *     hot path.
 *   - The protocol surface is small: sign a JWT with `aud`, `exp`, `sub`;
 *     POST to the subscription endpoint with `Authorization: vapid t=<jwt>,k=<pub>`
 *     and an empty body. The browser stack handles delivery.
 *
 * Configuration:
 *   - `VAPID_PRIVATE_KEY_PEM` — PEM-encoded P-256 private key (set this in
 *     production; generated once with `openssl ecparam` + `openssl pkcs8`).
 *   - `VAPID_PUBLIC_KEY` — base64url-encoded 65-byte uncompressed point.
 *   - `VAPID_SUBJECT` — `mailto:…` or `https://…` per RFC 8292 §2.
 *
 * Persistence/subscription-lifecycle is out of scope here; callers
 * maintain their own `_push_subscriptions` collection and pass each
 * subscription to `sendPush`.
 */

export interface PushSubscription {
  endpoint: string;
  keys?: {
    p256dh?: string;
    auth?: string;
  };
}

interface VapidConfig {
  publicKey: string;
  privateKeyPem: string;
  subject: string;
}

const TWELVE_HOURS_SECONDS = 12 * 60 * 60;

let cached: VapidConfig | null = null;
const loadConfig = (): VapidConfig | null => {
  if (cached) return cached;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const pem = process.env.VAPID_PRIVATE_KEY_PEM;
  const subj = process.env.VAPID_SUBJECT;
  if (!pub || !pem || !subj) return null;
  if (!subj.startsWith('mailto:') && !subj.startsWith('https://')) return null;
  cached = { publicKey: pub, privateKeyPem: pem, subject: subj };
  return cached;
};

export const isWebPushConfigured = (): boolean => loadConfig() !== null;

const base64Url = (buf: Buffer): string => buf.toString('base64url');

export interface SignJwtOptions {
  subject: string;
  privateKeyPem: string;
  expSeconds?: number;
  now?: () => number;
}

/**
 * Pure VAPID JWT signing. Returns the compact-form JWT.
 */
export const signVapidJwt = (audience: string, opts: SignJwtOptions): string => {
  if (typeof audience !== 'string' || !/^https?:\/\/[^/]+\/?$/.test(audience)) {
    throw new Error('audience must be an origin URL (scheme://host)');
  }
  if (typeof opts.privateKeyPem !== 'string' || !opts.privateKeyPem.includes('PRIVATE KEY')) {
    throw new Error('privateKeyPem must be a PEM-encoded private key');
  }
  const expSeconds = Math.min(opts.expSeconds ?? TWELVE_HOURS_SECONDS, TWELVE_HOURS_SECONDS);
  const now = opts.now ?? (() => Math.floor(Date.now() / 1000));
  const exp = now() + expSeconds;
  const header = { typ: 'JWT', alg: 'ES256' };
  const payload = { aud: audience.replace(/\/$/, ''), exp, sub: opts.subject };
  const enc = (obj: object): string => base64Url(Buffer.from(JSON.stringify(obj), 'utf8'));
  const signingInput = `${enc(header)}.${enc(payload)}`;
  const keyObj = createPrivateKey(opts.privateKeyPem);
  const sig = signCallback('sha256', Buffer.from(signingInput, 'utf8'), { key: keyObj, dsaEncoding: 'ieee-p1363' });
  return `${signingInput}.${base64Url(sig)}`;
};

/**
 * Send a notification. Returns:
 *   - { ok: true }
 *   - { ok: false, status, reason, expired? } — caller should delete the
 *     subscription when `expired` is true (404/410).
 */
export const sendPush = async (
  subscription: PushSubscription,
  options: { ttlSeconds?: number; urgency?: 'very-low' | 'low' | 'normal' | 'high'; topic?: string } = {},
): Promise<{ ok: true } | { ok: false; status: number; reason: string; expired?: boolean }> => {
  if (!subscription || typeof subscription.endpoint !== 'string' || !/^https?:\/\//.test(subscription.endpoint)) {
    return { ok: false, status: 0, reason: 'invalid-subscription' };
  }
  const cfg = loadConfig();
  if (!cfg) return { ok: false, status: 0, reason: 'vapid-not-configured' };

  let jwt: string;
  try {
    const url = new URL(subscription.endpoint);
    const audience = `${url.protocol}//${url.host}`;
    jwt = signVapidJwt(audience, {
      subject: cfg.subject,
      privateKeyPem: cfg.privateKeyPem,
    });
  } catch (err) {
    return { ok: false, status: 0, reason: (err as Error).message };
  }

  try {
    const res = await fetch(subscription.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `vapid t=${jwt},k=${cfg.publicKey}`,
        TTL: String(options.ttlSeconds ?? 60),
        ...(options.urgency ? { Urgency: options.urgency } : {}),
        ...(options.topic ? { Topic: options.topic } : {}),
        'Content-Length': '0',
      },
    });
    if (res.status >= 200 && res.status < 300) return { ok: true };
    return {
      ok: false,
      status: res.status,
      reason: `${res.status} ${res.statusText}`,
      expired: res.status === 404 || res.status === 410,
    };
  } catch (err) {
    logger.warn('webPush.send-failed', { error: (err as Error)?.message });
    return { ok: false, status: 0, reason: (err as Error)?.message ?? 'fetch-failed' };
  }
};

/** Stable fingerprint of a subscription for dedup in storage. */
export const subscriptionFingerprint = (sub: PushSubscription): string =>
  createHash('sha256').update(sub.endpoint).digest('base64url').slice(0, 32);

/**
 * Convenience for dev: generate a P-256 key-pair in the right shape.
 * Production should run `openssl` once and commit the public key to
 * the frontend bundle; this exists for first-bootstrap and tests.
 */
export const generateVapidKeyPair = (): { publicKey: string; privateKeyPem: string } => {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const pubBuf = publicKey.export({ type: 'spki', format: 'der' });
  // SPKI ends with the 65-byte uncompressed point at offset 26 for P-256.
  const rawPub = pubBuf.subarray(pubBuf.length - 65);
  return {
    publicKey: rawPub.toString('base64url'),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
  };
};

// Test helpers
export const _resetCache = (): void => { cached = null; };
