import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';

/**
 * AES-256-GCM field-level encryption.
 *
 * Why we need this in addition to the existing E2E-encrypted column types:
 *   - E2E encryption protects user data in transit + at the storage layer
 *     from the server itself; the server can't read user notes.
 *   - But internal fields (audit-log details, instance metadata, support
 *     tickets) sometimes need server-side processing AND at-rest
 *     confidentiality from a database snapshot leak. AES-GCM with a key
 *     derived from KMS handles this cleanly.
 *
 * Envelope:
 *   ciphertext_b64 = base64url(version|iv|ciphertext|authTag)
 *   version = 1 byte (currently 0x01)
 *   iv      = 12 bytes (GCM-recommended)
 *   tag     = 16 bytes (GCM auth tag, appended to data)
 *
 * Key derivation:
 *   - `FIELD_ENCRYPTION_KEY` env (base64url, 32 bytes raw) is the master.
 *   - Per-collection sub-key via SHA-256(master || collection-name) — so a
 *     leak from one collection's ciphertext can't decrypt another.
 */

const VERSION = 0x01;
const IV_LEN = 12;
const KEY_LEN = 32;

const decodeMasterKey = (raw: string | undefined): Buffer | null => {
  if (!raw) return null;
  try {
    const buf = Buffer.from(raw, 'base64url');
    if (buf.length !== KEY_LEN) return null;
    return buf;
  } catch {
    return null;
  }
};

let cachedMaster: Buffer | null | undefined; // undefined = not yet probed
const getMasterKey = (): Buffer | null => {
  if (cachedMaster !== undefined) return cachedMaster;
  cachedMaster = decodeMasterKey(process.env.FIELD_ENCRYPTION_KEY);
  return cachedMaster;
};

export const isFieldEncryptionConfigured = (): boolean => getMasterKey() !== null;

const deriveSubKey = (master: Buffer, scope: string): Buffer => {
  return createHash('sha256').update(master).update('\x00').update(scope).digest();
};

const SCOPE_PATTERN = /^[a-zA-Z0-9_.-]{1,64}$/;

const validateScope = (scope: string): void => {
  if (!SCOPE_PATTERN.test(scope)) {
    throw new Error('encryption scope must match [a-zA-Z0-9_.-]{1,64}');
  }
};

/**
 * Encrypt a plaintext string. Returns the base64url-encoded envelope.
 * Throws if no master key is configured — callers should branch on
 * `isFieldEncryptionConfigured()` to skip encryption in dev/test.
 */
export const encryptField = (plaintext: string, scope: string): string => {
  validateScope(scope);
  const master = getMasterKey();
  if (!master) throw new Error('FIELD_ENCRYPTION_KEY not configured');
  if (typeof plaintext !== 'string') throw new Error('plaintext must be a string');

  const subKey = deriveSubKey(master, scope);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', subKey, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const envelope = Buffer.concat([Buffer.from([VERSION]), iv, tag, enc]);
  return envelope.toString('base64url');
};

/**
 * Decrypt an envelope produced by encryptField. Throws on:
 *   - missing master key
 *   - malformed envelope
 *   - unknown version
 *   - auth-tag verification failure (data was tampered with)
 *
 * Returns the original plaintext.
 */
export const decryptField = (envelopeB64: string, scope: string): string => {
  validateScope(scope);
  const master = getMasterKey();
  if (!master) throw new Error('FIELD_ENCRYPTION_KEY not configured');
  if (typeof envelopeB64 !== 'string' || envelopeB64.length === 0) {
    throw new Error('envelope must be a non-empty string');
  }
  const env = Buffer.from(envelopeB64, 'base64url');
  if (env.length < 1 + IV_LEN + 16 + 1) throw new Error('envelope too short');
  const version = env[0];
  if (version !== VERSION) throw new Error(`unsupported envelope version: ${version}`);
  const iv = env.subarray(1, 1 + IV_LEN);
  const tag = env.subarray(1 + IV_LEN, 1 + IV_LEN + 16);
  const ct = env.subarray(1 + IV_LEN + 16);

  const subKey = deriveSubKey(master, scope);
  const decipher = createDecipheriv('aes-256-gcm', subKey, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ct), decipher.final()]);
  return plain.toString('utf8');
};

/**
 * Try to decrypt; return null on any failure (corrupt/missing/wrong-scope).
 * Useful for migrations where some rows are encrypted and some are plain.
 */
export const tryDecryptField = (envelopeB64: string | null | undefined, scope: string): string | null => {
  if (!envelopeB64) return null;
  try { return decryptField(envelopeB64, scope); } catch { return null; }
};

// Test-only resets
export const _resetMasterCache = (): void => { cachedMaster = undefined; };
