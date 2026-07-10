/**
 * cryptoV3 — modern, authenticated, per-user encryption (implements ADR-0001).
 *
 * - Content cipher: AES-256-GCM (authenticated; tampering is rejected, unlike the
 *   legacy unauthenticated AES-CBC scheme).
 * - Key derivation: Argon2id (memory-hard) with a PBKDF2-SHA256 fallback for
 *   runtimes where Argon2 is unavailable or too slow.
 * - Per-user `dataKey` (random 256-bit) wrapped by a password-derived `rootKey`.
 *   The server only ever stores the *wrapped* key, never the password or dataKey.
 *
 * Pure JS via @noble/* — works identically in React Native (Hermes), web and Node,
 * with no native modules. `randomBytes` relies on a CSPRNG; React Native must have
 * `react-native-get-random-values` imported at app entry (it already is).
 */
import { gcm } from '@noble/ciphers/aes';
import { argon2idAsync } from '@noble/hashes/argon2';
import { pbkdf2Async } from '@noble/hashes/pbkdf2';
import { sha256 } from '@noble/hashes/sha2';
import { randomBytes, utf8ToBytes, bytesToUtf8, concatBytes } from '@noble/hashes/utils';

export const V3_PREFIX = 'v3:'; // wrapped content envelope
export const V3_WRAP_PREFIX = 'v3w:'; // wrapped-key envelope

const IV_LEN = 12; // AES-GCM standard nonce length
const KEY_LEN = 32; // AES-256
export const SALT_LEN = 16;

/**
 * Argon2id parameters. Tuned for a pure-JS runtime (Hermes/browsers): OWASP's
 * lighter-but-acceptable profile (19 MiB, 2 passes) so a once-per-unlock
 * derivation stays in the sub-second-to-low-second range on a phone. The chosen
 * KDF + params are recorded alongside the wrapped key (see `KdfParams`) so they
 * can be bumped later WITHOUT breaking existing wraps — a wrap made with old
 * params is always re-derived with those exact stored params.
 */
export const ARGON2_PARAMS = { t: 2, m: 19456, p: 1, dkLen: KEY_LEN } as const;

/**
 * PBKDF2-HMAC-SHA256 iteration count for NEW derivations. 600k is the OWASP 2023+
 * minimum for PBKDF2-SHA256 (the earlier 200k baseline is retained only as the
 * fallback for wraps enrolled before params were persisted — see LEGACY). PBKDF2 is
 * only ever reached when Argon2id is unavailable in the runtime, so this heavier
 * count runs on a rare path.
 */
export const PBKDF2_ITERATIONS = 600_000;
/** Iteration count for pbkdf2 wraps created before per-wrap params were stored. */
export const LEGACY_PBKDF2_ITERATIONS = 200_000;

export type KdfId = 'argon2id' | 'pbkdf2-sha256';

/** Argon2id cost params as persisted alongside a wrap (dkLen is fixed at KEY_LEN). */
export interface Argon2Params { m: number; t: number; p: number }
/** PBKDF2 cost params as persisted alongside a wrap. */
export interface Pbkdf2Params { c: number }
/** The KDF cost parameters recorded with a wrapped key so unwrap can reproduce the exact key. */
export type KdfParams = Argon2Params | Pbkdf2Params;

/** The cost params a NEW derivation uses for a given KDF (persist these with the wrap). */
export const defaultKdfParams = (kdf: KdfId): KdfParams =>
  kdf === 'argon2id'
    ? { m: ARGON2_PARAMS.m, t: ARGON2_PARAMS.t, p: ARGON2_PARAMS.p }
    : { c: PBKDF2_ITERATIONS };

/** Validate an untrusted params object for a KDF; returns null if not usable (caller then uses
 *  the legacy defaults). Guards against a tampered/garbage params field weakening or breaking a
 *  derivation. */
export const parseKdfParams = (kdf: KdfId, raw: unknown): KdfParams | null => {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const posInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0;
  if (kdf === 'argon2id') {
    if (posInt(o.m) && posInt(o.t) && posInt(o.p)) return { m: o.m, t: o.t, p: o.p };
    return null;
  }
  if (posInt(o.c)) return { c: o.c };
  return null;
};

// ---------------------------------------------------------------------------
// base64 (pure, no btoa/Buffer dependency so it is identical across runtimes)
// ---------------------------------------------------------------------------
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP: Record<string, number> = (() => {
  const m: Record<string, number> = {};
  for (let i = 0; i < B64.length; i++) m[B64[i]] = i;
  return m;
})();

export function bytesToB64(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  const rem = bytes.length - i;
  if (rem === 1) {
    const n = bytes[i] << 16;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + '==';
  } else if (rem === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + '=';
  }
  return out;
}

export function b64ToBytes(b64: string): Uint8Array {
  // Strip padding and any stray chars; `clean` then holds only data characters,
  // so the decoded length is floor(clean.length * 3 / 4) with no pad subtraction.
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const outLen = Math.floor((clean.length * 3) / 4);
  const out = new Uint8Array(outLen);
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n =
      (B64_LOOKUP[clean[i]] << 18) |
      (B64_LOOKUP[clean[i + 1]] << 12) |
      ((B64_LOOKUP[clean[i + 2]] ?? 0) << 6) |
      (B64_LOOKUP[clean[i + 3]] ?? 0);
    if (o < outLen) out[o++] = (n >> 16) & 0xff;
    if (o < outLen) out[o++] = (n >> 8) & 0xff;
    if (o < outLen) out[o++] = n & 0xff;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Key material
// ---------------------------------------------------------------------------
export const generateDataKey = (): Uint8Array => randomBytes(KEY_LEN);
export const generateSalt = (): Uint8Array => randomBytes(SALT_LEN);

// Crockford base32 (no I/L/O/U — avoids ambiguous characters when written down).
const RECOVERY_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Human-writable recovery code with ~100 bits of entropy (20 chars), grouped in
 * 4-char blocks: e.g. "K7Q2-9MTR-...". Used to wrap a second copy of the dataKey so
 * the user can recover after forgetting their password. Normalise input with
 * `normalizeRecoveryCode` before deriving a key from it.
 */
export const generateRecoveryCode = (): string => {
  const bytes = randomBytes(20);
  let out = '';
  for (let i = 0; i < 20; i++) out += RECOVERY_ALPHABET[bytes[i] & 31];
  return (out.match(/.{1,4}/g) || [out]).join('-');
};

/** Strip grouping/whitespace and upper-case so display formatting doesn't affect the key. */
export const normalizeRecoveryCode = (code: string): string =>
  code.replace(/[^0-9a-zA-Z]/g, '').toUpperCase();

/**
 * Derive a 256-bit root key from the user's password. Tries Argon2id first and
 * transparently falls back to PBKDF2-SHA256 if Argon2 throws in the runtime.
 * Returns both the key and which KDF was actually used (persist it so the same
 * KDF is used when unwrapping later).
 */
export async function deriveRootKey(
  password: string,
  salt: Uint8Array,
  preferred: KdfId = 'argon2id',
): Promise<{ key: Uint8Array; kdf: KdfId; params: KdfParams }> {
  const pwd = utf8ToBytes(password);
  if (preferred === 'argon2id') {
    // Argon2id from @noble is PURE JS, so it is always *available* — a throw here is a transient
    // condition (e.g. a 19 MiB alloc failing under memory pressure), not "unsupported". Retrying
    // once avoids silently and PERMANENTLY pinning the account to the weaker KDF on a one-off blip
    // (audit finding: silent KDF downgrade). Only a repeated failure falls back — and the fallback
    // is now OWASP-strength PBKDF2 (600k), not the old 200k.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const key = await argon2idAsync(pwd, salt, ARGON2_PARAMS);
        return { key, kdf: 'argon2id', params: defaultKdfParams('argon2id') };
      } catch {
        // retry once, then fall through to PBKDF2
      }
    }
  }
  const key = await pbkdf2Async(sha256, pwd, salt, { c: PBKDF2_ITERATIONS, dkLen: KEY_LEN });
  return { key, kdf: 'pbkdf2-sha256', params: defaultKdfParams('pbkdf2-sha256') };
}

/**
 * Re-derive a root key with a known KDF (used on unwrap). `params` are the cost parameters that were
 * recorded with the wrap; when absent (a wrap enrolled before params were persisted) the original
 * baselines are used so the SAME key is reproduced — this is what makes it safe to raise the NEW-wrap
 * defaults above without locking anyone out.
 */
export async function deriveRootKeyWithKdf(
  password: string,
  salt: Uint8Array,
  kdf: KdfId,
  params?: KdfParams | null,
): Promise<Uint8Array> {
  const pwd = utf8ToBytes(password);
  const valid = params ? parseKdfParams(kdf, params) : null;
  if (kdf === 'argon2id') {
    const a = valid as Argon2Params | null;
    const argonParams = a ? { m: a.m, t: a.t, p: a.p, dkLen: KEY_LEN } : ARGON2_PARAMS;
    return argon2idAsync(pwd, salt, argonParams);
  }
  const c = (valid as Pbkdf2Params | null)?.c ?? LEGACY_PBKDF2_ITERATIONS;
  return pbkdf2Async(sha256, pwd, salt, { c, dkLen: KEY_LEN });
}

// ---------------------------------------------------------------------------
// Content encryption (AES-256-GCM)
// ---------------------------------------------------------------------------
function gcmSeal(key: Uint8Array, plaintext: Uint8Array): Uint8Array {
  const iv = randomBytes(IV_LEN);
  const ct = gcm(key, iv).encrypt(plaintext);
  return concatBytes(iv, ct);
}

function gcmOpen(key: Uint8Array, sealed: Uint8Array): Uint8Array {
  const iv = sealed.subarray(0, IV_LEN);
  const ct = sealed.subarray(IV_LEN);
  return gcm(key, iv).decrypt(ct); // throws if auth tag is invalid
}

/** Encrypt a string to a `v3:`-prefixed envelope. */
export function encryptV3(plaintext: string, dataKey: Uint8Array): string {
  return V3_PREFIX + bytesToB64(gcmSeal(dataKey, utf8ToBytes(plaintext)));
}

/** Decrypt a `v3:` envelope. Throws on a wrong key or tampered ciphertext. */
export function decryptV3(envelope: string, dataKey: Uint8Array): string {
  if (!isV3(envelope)) throw new Error('not a v3 envelope');
  return bytesToUtf8(gcmOpen(dataKey, b64ToBytes(envelope.slice(V3_PREFIX.length))));
}

export const isV3 = (value: unknown): value is string =>
  typeof value === 'string' && value.startsWith(V3_PREFIX);

// ---------------------------------------------------------------------------
// Key wrapping (dataKey sealed under rootKey)
// ---------------------------------------------------------------------------
export function wrapDataKey(dataKey: Uint8Array, rootKey: Uint8Array): string {
  return V3_WRAP_PREFIX + bytesToB64(gcmSeal(rootKey, dataKey));
}

export function unwrapDataKey(wrapped: string, rootKey: Uint8Array): Uint8Array {
  if (!wrapped.startsWith(V3_WRAP_PREFIX)) throw new Error('not a wrapped key');
  return gcmOpen(rootKey, b64ToBytes(wrapped.slice(V3_WRAP_PREFIX.length)));
}

export const isWrappedKey = (value: unknown): value is string =>
  typeof value === 'string' && value.startsWith(V3_WRAP_PREFIX);
