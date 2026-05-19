/**
 * Password hasher facade.
 *
 * Why: bcryptjs (currently in deps) is pure-JS and considerably slower than
 * the native bcrypt build, AND its cost-factor ceiling is being outpaced by
 * GPU cracking. Argon2id (RFC 9106) is the OWASP-recommended modern algorithm:
 * memory-hard, side-channel resistant, configurable per the standard.
 *
 * Strategy: every NEW hash uses Argon2id. Existing bcrypt hashes still
 * verify correctly via `verify()`, and `needsRehash()` returns true so
 * login flows can transparently upgrade old users.
 *
 * The actual `argon2` native module is hoisted in the workspace but we
 * dynamic-require it so missing-native-build environments (some CI
 * containers) don't crash at import time — they fall back to bcrypt-only
 * mode with a warning.
 */

import logger from './logger';

// Argon2id parameters: OWASP "Password Storage Cheat Sheet" defaults as of 2024.
// memoryCost = 19 MiB, timeCost = 2, parallelism = 1.
const ARGON_OPTIONS = {
  type: 2, // argon2.argon2id
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

type Argon2Module = {
  argon2id: number;
  hash: (plain: string, opts: Record<string, unknown>) => Promise<string>;
  verify: (hash: string, plain: string) => Promise<boolean>;
  needsRehash: (hash: string, opts: Record<string, unknown>) => boolean;
};

let argon2: Argon2Module | null = null;
let argonProbed = false;

const probeArgon2 = (): Argon2Module | null => {
  if (argonProbed) return argon2;
  argonProbed = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('argon2') as Argon2Module;
    if (mod && typeof mod.hash === 'function' && typeof mod.verify === 'function') {
      argon2 = mod;
      return argon2;
    }
  } catch (err) {
    logger.warn('passwordHasher: argon2 unavailable, falling back to bcrypt', {
      error: (err as Error)?.message,
    });
  }
  return null;
};

const isBcryptHash = (hash: string): boolean => /^\$2[aby]\$/.test(hash);
const isArgon2Hash = (hash: string): boolean => hash.startsWith('$argon2');

const loadBcrypt = () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('bcryptjs') as {
    hash: (s: string, salt: number | string) => Promise<string>;
    compare: (s: string, h: string) => Promise<boolean>;
  };
};

const BCRYPT_ROUNDS = 12;

/**
 * Hash a plaintext password. Always produces Argon2id when available,
 * bcrypt otherwise. Throws on input shorter than 8 chars (basic sanity —
 * callers should also enforce a real password policy at the validation
 * layer; this is the LAST line of defence).
 */
export const hashPassword = async (plain: string): Promise<string> => {
  if (typeof plain !== 'string' || plain.length < 8) {
    throw new Error('password too short');
  }
  if (plain.length > 1024) {
    // Pathological input — both argon2 and bcrypt slow down dramatically with
    // huge inputs. Reject anything that's not a realistic password.
    throw new Error('password too long');
  }
  const a = probeArgon2();
  if (a) return a.hash(plain, ARGON_OPTIONS);
  return loadBcrypt().hash(plain, BCRYPT_ROUNDS);
};

/**
 * Verify a plaintext password against a stored hash. Handles both bcrypt
 * (legacy users) and Argon2id (current). Returns false on malformed hash
 * rather than throwing — login paths treat both "wrong password" and
 * "corrupt hash" as "no, that's not it".
 */
export const verifyPassword = async (plain: string, hash: string): Promise<boolean> => {
  if (typeof plain !== 'string' || typeof hash !== 'string' || hash.length === 0) return false;
  try {
    if (isArgon2Hash(hash)) {
      const a = probeArgon2();
      if (!a) {
        logger.warn('passwordHasher: argon2 hash present but argon2 unavailable');
        return false;
      }
      return await a.verify(hash, plain);
    }
    if (isBcryptHash(hash)) {
      return await loadBcrypt().compare(plain, hash);
    }
    return false;
  } catch (err) {
    logger.warn('passwordHasher: verify error', { error: (err as Error)?.message });
    return false;
  }
};

/**
 * Returns true when the stored hash should be re-hashed with current params.
 * Used by login: after successful verify(), if needsRehash() then re-hash
 * and write back to the user document. This transparently migrates bcrypt
 * users to argon2id and keeps argon2id users on the current parameters.
 */
export const needsRehash = (hash: string): boolean => {
  if (typeof hash !== 'string') return true;
  if (isBcryptHash(hash)) {
    // Always upgrade bcrypt → argon2id when argon2 is available.
    return probeArgon2() !== null;
  }
  if (isArgon2Hash(hash)) {
    const a = probeArgon2();
    if (!a) return false;
    try { return a.needsRehash(hash, ARGON_OPTIONS); } catch { return false; }
  }
  return true; // unrecognised — force a rehash on next login
};

export const getActiveAlgorithm = (): 'argon2id' | 'bcrypt' => probeArgon2() ? 'argon2id' : 'bcrypt';

// Test-only helpers.
export const _isArgon2Hash = isArgon2Hash;
export const _isBcryptHash = isBcryptHash;
