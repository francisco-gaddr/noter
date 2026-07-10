/**
 * v3 E2E key bootstrap — platform-agnostic. Activates per-user AES-256-GCM
 * encryption by installing the user's `dataKey` via setActiveDataKey().
 *
 * Dependency-injected (BootstrapDeps) so the same tested logic drives the mobile
 * adapter (expo-secure-store + fetchWithAuth) and the web adapter (browser fetch +
 * a browser key store). No platform APIs here.
 *
 * Safety invariants:
 *   - The server only ever receives the *wrapped* dataKey (opaque to it).
 *   - Persist the bundle (server) + dataKey (device) BEFORE activating writes, so a
 *     crash mid-enrolment never leaves unreadable v3 data.
 *   - Any failure throws and leaves the app on the legacy scheme (caller catches).
 */
import {
  deriveRootKey,
  deriveRootKeyWithKdf,
  generateDataKey,
  generateSalt,
  wrapDataKey,
  unwrapDataKey,
  bytesToB64,
  b64ToBytes,
  generateRecoveryCode,
  normalizeRecoveryCode,
  type KdfId,
  type KdfParams,
} from './cryptoV3';
import { setActiveDataKey } from './encrypt';

export const KEY_VERSION = 1;

/**
 * Minimum E2E password length. Argon2id raises the per-guess cost but cannot rescue a trivially small
 * search space against an offline attack on the server-held wrapped dataKey — so the shared bootstrap
 * enforces a floor (not only the UI). 8 is the OWASP absolute minimum for a user-chosen secret; this
 * is deliberately a LOW floor (usability) not a strength meter — the UI may require more.
 *
 * IMPORTANT: enforced ONLY on enrolment + password CHANGE (where the user picks a NEW secret). Unlock
 * of an EXISTING bundle never applies it — a user who enrolled earlier with a short password must
 * still be able to sign in (the fix must not lock anyone out of their own data).
 */
export const MIN_E2E_PASSWORD_LENGTH = 8;

export class WeakPasswordError extends Error {
  constructor(message = `Lösenordet måste vara minst ${MIN_E2E_PASSWORD_LENGTH} tecken.`) {
    super(message);
    this.name = 'WeakPasswordError';
    Object.setPrototypeOf(this, WeakPasswordError.prototype);
  }
}

/** True when a NEW password meets the minimum policy for wrapping the dataKey. */
export const isAcceptableE2EPassword = (password: unknown): password is string =>
  typeof password === 'string' && password.length >= MIN_E2E_PASSWORD_LENGTH;

export interface KeyBundle {
  wrappedDataKey: string;
  kdfSalt: string; // base64
  kdf: KdfId;
  /** KDF cost params recorded WITH the wrap so unwrap reproduces the exact key even after the
   *  NEW-wrap defaults are raised. Absent on bundles enrolled before this field existed → unwrap
   *  falls back to the original baselines (argon 19MiB/t2/p1, pbkdf2 200k). */
  kdfParams?: KdfParams;
  keyVersion: number;
  // Optional recovery wrap: a second copy of the dataKey sealed under a key
  // derived from a one-time recovery code, so a forgotten password isn't data loss.
  recoveryWrappedDataKey?: string;
  recoverySalt?: string; // base64
  recoveryKdf?: KdfId;
  recoveryKdfParams?: KdfParams;
}

export interface BootstrapDeps {
  /** GET the server key bundle, or null if the user hasn't enrolled (404). */
  getBundle: () => Promise<KeyBundle | null>;
  /** PUT the server key bundle (enrol / rotate). */
  putBundle: (bundle: KeyBundle) => Promise<void>;
  /** Read the base64 dataKey from device secure storage, or null. */
  secureGetDataKey: () => Promise<string | null>;
  /** Persist the base64 dataKey to device secure storage (Keychain/Keystore). */
  secureSetDataKey: (b64: string) => Promise<void>;
}

/**
 * Re-activate v3 from the device backup (no password). Returns true if a key was
 * found and installed, false if the device isn't enrolled.
 */
export async function restoreFromDevice(deps: BootstrapDeps): Promise<boolean> {
  const b64 = await deps.secureGetDataKey();
  if (!b64) return false;
  setActiveDataKey(b64ToBytes(b64));
  return true;
}

export type BootstrapResult = 'enrolled' | 'unlocked';

export interface EnrollOutcome {
  result: BootstrapResult;
  /** Present only on first enrolment — show once, never stored in plaintext. */
  recoveryCode?: string;
}

/**
 * Enrol (first time) or unlock (existing bundle) with the user's password.
 * Throws on a wrong password (the unwrap auth tag fails). On first enrolment,
 * returns a one-time recovery code the caller must display to the user.
 */
export async function enrollOrUnlock(password: string, deps: BootstrapDeps): Promise<EnrollOutcome> {
  const existing = await deps.getBundle();

  if (existing) {
    const rootKey = await deriveRootKeyWithKdf(password, b64ToBytes(existing.kdfSalt), existing.kdf, existing.kdfParams);
    const dataKey = unwrapDataKey(existing.wrappedDataKey, rootKey); // throws on wrong password
    rootKey.fill(0); // zeroize the password-derived key once the dataKey is unwrapped
    await deps.secureSetDataKey(bytesToB64(dataKey));
    setActiveDataKey(dataKey);
    return { result: 'unlocked' };
  }

  // First-time enrolment — the user is choosing a NEW secret, so enforce the floor here (never on
  // the unlock path above).
  if (!isAcceptableE2EPassword(password)) throw new WeakPasswordError();
  const salt = generateSalt();
  const { key: rootKey, kdf, params } = await deriveRootKey(password, salt);
  const dataKey = generateDataKey();

  // Also wrap the dataKey under a one-time recovery code.
  const recoveryCode = generateRecoveryCode();
  const recoverySalt = generateSalt();
  const { key: recoveryKey, kdf: recoveryKdf, params: recoveryParams } = await deriveRootKey(normalizeRecoveryCode(recoveryCode), recoverySalt);

  const bundle: KeyBundle = {
    wrappedDataKey: wrapDataKey(dataKey, rootKey),
    kdfSalt: bytesToB64(salt),
    kdf,
    kdfParams: params,
    keyVersion: KEY_VERSION,
    recoveryWrappedDataKey: wrapDataKey(dataKey, recoveryKey),
    recoverySalt: bytesToB64(recoverySalt),
    recoveryKdf,
    recoveryKdfParams: recoveryParams,
  };
  rootKey.fill(0);
  recoveryKey.fill(0);
  // Persist everywhere BEFORE activating writes.
  await deps.putBundle(bundle);
  await deps.secureSetDataKey(bytesToB64(dataKey));
  setActiveDataKey(dataKey);
  return { result: 'enrolled', recoveryCode };
}

/**
 * Recover access with the one-time recovery code (e.g. after a forgotten
 * password). Unwraps the dataKey from the recovery wrap and re-activates it.
 * Throws if the bundle has no recovery wrap or the code is wrong.
 */
export async function recoverWithCode(code: string, deps: BootstrapDeps): Promise<void> {
  const bundle = await deps.getBundle();
  if (!bundle?.recoveryWrappedDataKey || !bundle.recoverySalt || !bundle.recoveryKdf) {
    throw new Error('Ingen återställningskod är registrerad för detta konto');
  }
  const recoveryKey = await deriveRootKeyWithKdf(
    normalizeRecoveryCode(code),
    b64ToBytes(bundle.recoverySalt),
    bundle.recoveryKdf,
    bundle.recoveryKdfParams,
  );
  const dataKey = unwrapDataKey(bundle.recoveryWrappedDataKey, recoveryKey); // throws on wrong code
  recoveryKey.fill(0);
  await deps.secureSetDataKey(bytesToB64(dataKey));
  setActiveDataKey(dataKey);
}

/**
 * Change the account password WITHOUT re-encrypting any data. Envelope encryption
 * means only the *wrapping* of the dataKey changes: we unwrap with the old password
 * (which verifies it), derive a fresh root key from the new password + a new salt,
 * and re-wrap the SAME dataKey. All existing v3 content stays readable because the
 * dataKey is unchanged. The recovery wrap is preserved (the recovery code keeps
 * working). Throws on a wrong old password (the unwrap auth tag fails).
 */
export async function changePassword(
  oldPassword: string,
  newPassword: string,
  deps: BootstrapDeps,
): Promise<void> {
  if (!newPassword || newPassword.length < 1) {
    throw new Error('Nytt lösenord saknas');
  }
  // The new password re-wraps the dataKey → enforce the same floor as enrolment.
  if (!isAcceptableE2EPassword(newPassword)) throw new WeakPasswordError();
  const existing = await deps.getBundle();
  if (!existing) {
    throw new Error('Inget nyckelpaket att byta lösenord för (ej registrerad)');
  }

  // Verify the old password by unwrapping the current dataKey.
  const oldRootKey = await deriveRootKeyWithKdf(oldPassword, b64ToBytes(existing.kdfSalt), existing.kdf, existing.kdfParams);
  const dataKey = unwrapDataKey(existing.wrappedDataKey, oldRootKey); // throws on wrong old password
  oldRootKey.fill(0);

  // Re-wrap the SAME dataKey under a fresh root key derived from the new password (with the
  // current — possibly strengthened — KDF defaults, recorded in the new bundle).
  const newSalt = generateSalt();
  const { key: newRootKey, kdf: newKdf, params: newParams } = await deriveRootKey(newPassword, newSalt);

  const bundle: KeyBundle = {
    ...existing,
    wrappedDataKey: wrapDataKey(dataKey, newRootKey),
    kdfSalt: bytesToB64(newSalt),
    kdf: newKdf,
    kdfParams: newParams,
    keyVersion: KEY_VERSION,
    // recovery* fields preserved from `existing` via the spread — same dataKey,
    // so the recovery code still unwraps it.
  };
  newRootKey.fill(0);

  await deps.putBundle(bundle);
  // dataKey is unchanged, but refresh the device copy for good measure and keep
  // the active key installed so the session continues uninterrupted.
  await deps.secureSetDataKey(bytesToB64(dataKey));
  setActiveDataKey(dataKey);
}

/** Clear the active key (on lock / logout). Legacy reads still work. */
export function lockCrypto(): void {
  setActiveDataKey(null);
}
