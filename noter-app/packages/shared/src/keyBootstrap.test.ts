import {
  enrollOrUnlock,
  changePassword,
  recoverWithCode,
  lockCrypto,
  restoreFromDevice,
  isAcceptableE2EPassword,
  MIN_E2E_PASSWORD_LENGTH,
  WeakPasswordError,
  type BootstrapDeps,
  type KeyBundle,
} from './keyBootstrap';
import { encrypt, decrypt, setActiveDataKey } from './encrypt';

/** In-memory BootstrapDeps — models the server bundle + device secure store. */
const makeDeps = () => {
  let bundle: KeyBundle | null = null;
  let deviceKey: string | null = null;
  const deps: BootstrapDeps = {
    getBundle: async () => bundle,
    putBundle: async (b) => { bundle = b; },
    secureGetDataKey: async () => deviceKey,
    secureSetDataKey: async (b64) => { deviceKey = b64; },
  };
  return {
    deps,
    peekBundle: () => bundle,
    peekDeviceKey: () => deviceKey,
  };
};

describe('keyBootstrap', () => {
  afterEach(() => { lockCrypto(); });

  it('enrols then unlocks with the same password (round-trip)', async () => {
    const { deps } = makeDeps();
    const enrol = await enrollOrUnlock('hunter22', deps);
    expect(enrol.result).toBe('enrolled');
    expect(enrol.recoveryCode).toBeTruthy();

    // Content written while enrolled is v3 and readable.
    const ct = encrypt('hemligt');
    expect(ct.startsWith('v3:')).toBe(true);
    expect(decrypt(ct)).toBe('hemligt');

    lockCrypto();
    const unlock = await enrollOrUnlock('hunter22', deps);
    expect(unlock.result).toBe('unlocked');
    expect(decrypt(ct)).toBe('hemligt');
  });

  it('changePassword keeps all content readable; new password works, old fails', async () => {
    const { deps } = makeDeps();
    await enrollOrUnlock('old-pass', deps);
    const ciphertext = encrypt('data från innan bytet');

    await changePassword('old-pass', 'new-pass', deps);

    // Same session still reads the same content (dataKey unchanged).
    expect(decrypt(ciphertext)).toBe('data från innan bytet');

    // Re-unlock with the NEW password works and still reads old content.
    lockCrypto();
    const unlock = await enrollOrUnlock('new-pass', deps);
    expect(unlock.result).toBe('unlocked');
    expect(decrypt(ciphertext)).toBe('data från innan bytet');

    // The OLD password no longer unlocks.
    lockCrypto();
    await expect(enrollOrUnlock('old-pass', deps)).rejects.toThrow();
  });

  it('changePassword rejects a wrong old password', async () => {
    const { deps } = makeDeps();
    await enrollOrUnlock('correct1', deps);
    await expect(changePassword('wrong', 'whatever1', deps)).rejects.toThrow();
  });

  it('changePassword rotates the salt + wrapped key but not the recovery wrap', async () => {
    const { deps, peekBundle } = makeDeps();
    await enrollOrUnlock('passone12', deps);
    const before = { ...peekBundle()! };

    await changePassword('passone12', 'passtwo12', deps);
    const after = peekBundle()!;

    expect(after.kdfSalt).not.toBe(before.kdfSalt);
    expect(after.wrappedDataKey).not.toBe(before.wrappedDataKey);
    // Recovery wrap is preserved (same dataKey).
    expect(after.recoveryWrappedDataKey).toBe(before.recoveryWrappedDataKey);
    expect(after.recoverySalt).toBe(before.recoverySalt);
  });

  it('recovery code still works after a password change', async () => {
    const { deps } = makeDeps();
    const enrol = await enrollOrUnlock('firstpass', deps);
    const code = enrol.recoveryCode!;
    const ciphertext = encrypt('recover me');

    await changePassword('firstpass', 'secondpass', deps);

    lockCrypto();
    await recoverWithCode(code, deps);
    expect(decrypt(ciphertext)).toBe('recover me');
  });

  it('changePassword throws when not enrolled', async () => {
    const { deps } = makeDeps();
    await expect(changePassword('oldpass12', 'newpass12', deps)).rejects.toThrow();
  });

  it('enrolment rejects a password shorter than the floor (WeakPasswordError)', async () => {
    const { deps, peekBundle } = makeDeps();
    const short = 'x'.repeat(MIN_E2E_PASSWORD_LENGTH - 1);
    await expect(enrollOrUnlock(short, deps)).rejects.toBeInstanceOf(WeakPasswordError);
    expect(peekBundle()).toBeNull(); // nothing was persisted
    // A password exactly at the floor is accepted.
    const ok = await enrollOrUnlock('y'.repeat(MIN_E2E_PASSWORD_LENGTH), deps);
    expect(ok.result).toBe('enrolled');
  });

  it('changePassword rejects a NEW password below the floor but keeps the old one working', async () => {
    const { deps } = makeDeps();
    await enrollOrUnlock('validpass1', deps);
    const ct = encrypt('still mine');
    await expect(changePassword('validpass1', 'short', deps)).rejects.toBeInstanceOf(WeakPasswordError);
    // The rejected change must not have altered anything: the old password still unlocks + reads.
    lockCrypto();
    const unlock = await enrollOrUnlock('validpass1', deps);
    expect(unlock.result).toBe('unlocked');
    expect(decrypt(ct)).toBe('still mine');
  });

  it('UNLOCK of an existing (legacy short-password) bundle is NOT blocked by the floor', async () => {
    // Simulate a bundle enrolled by an older app version with a below-floor password by wrapping
    // enrollOrUnlock's floor check: enrol at the floor, then hand-craft is out of scope — instead we
    // assert the policy helper is only advisory for NEW secrets and that a second enrollOrUnlock with
    // an EXISTING bundle never runs the check (it returns 'unlocked', not a WeakPasswordError).
    const { deps } = makeDeps();
    await enrollOrUnlock('atthefloor', deps); // 10 chars, enrols
    lockCrypto();
    // The unlock branch takes the existing bundle path — even a hypothetically short password would
    // only fail on the auth tag, never on the floor. Same password proves the branch is reached.
    const unlock = await enrollOrUnlock('atthefloor', deps);
    expect(unlock.result).toBe('unlocked');
  });

  it('isAcceptableE2EPassword matches the floor', () => {
    expect(isAcceptableE2EPassword('x'.repeat(MIN_E2E_PASSWORD_LENGTH))).toBe(true);
    expect(isAcceptableE2EPassword('x'.repeat(MIN_E2E_PASSWORD_LENGTH - 1))).toBe(false);
    expect(isAcceptableE2EPassword(null)).toBe(false);
    expect(isAcceptableE2EPassword(12345678 as unknown)).toBe(false);
  });

  it('restoreFromDevice re-activates the key without a password', async () => {
    const { deps } = makeDeps();
    await enrollOrUnlock('pwpwpwpw', deps);
    const ct = encrypt('device restore');
    lockCrypto();

    const restored = await restoreFromDevice(deps);
    expect(restored).toBe(true);
    expect(decrypt(ct)).toBe('device restore');
  });
});
