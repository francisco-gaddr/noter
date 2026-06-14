import { createHash, timingSafeEqual, randomBytes } from 'node:crypto';

/**
 * CalDAV Basic-Auth credentials. Mirrors the api-key approach: the password is a
 * high-entropy secret shown to the user exactly ONCE; only its SHA-256 is stored
 * (`davTokenHash`), and verification is constant-time. The username (`davUser`) is a
 * non-secret, unguessable lookup key so we can find the feed before comparing hashes.
 *
 * This is deliberately SEPARATE from the user's primary password and from the public
 * ICS `token` — revoking a DAV credential destroys only that one feed's CalDAV access.
 */

const sha256 = (input: string): string => createHash('sha256').update(input).digest('hex');

/** Non-secret username, e.g. `noter-3f9a2c1b8d`. Safe for Basic Auth (no colon). */
export const genDavUser = (): string => `noter-${randomBytes(8).toString('hex')}`;

/** 32-char base64url secret (≈192 bits). Shown once; only the hash is persisted. */
export const genDavPassword = (): string => randomBytes(24).toString('base64url').slice(0, 32);

export const hashDavPassword = (password: string): string => sha256(password);

/** Constant-time compare of a presented password against a stored SHA-256 hash. */
export const verifyDavPassword = (password: string, storedHash?: string | null): boolean => {
  if (!password || !storedHash) return false;
  const expected = Buffer.from(storedHash, 'hex');
  const actual = Buffer.from(sha256(password), 'hex');
  if (expected.length === 0 || expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
};

/** Parse an `Authorization: Basic base64(user:pass)` header. Returns null if absent/malformed. */
export const parseBasicAuth = (header: unknown): { user: string; pass: string } | null => {
  if (typeof header !== 'string') return null;
  const m = /^basic\s+(.+)$/i.exec(header.trim());
  if (!m) return null;
  let decoded = '';
  try {
    decoded = Buffer.from(m[1], 'base64').toString('utf8');
  } catch {
    return null;
  }
  const sep = decoded.indexOf(':');
  if (sep === -1) return null;
  return { user: decoded.slice(0, sep), pass: decoded.slice(sep + 1) };
};
