import {
  enrollOrUnlock,
  changePassword,
  recoverWithCode,
  lockCrypto,
  restoreFromDevice,
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
    const enrol = await enrollOrUnlock('hunter2', deps);
    expect(enrol.result).toBe('enrolled');
    expect(enrol.recoveryCode).toBeTruthy();

    // Content written while enrolled is v3 and readable.
    const ct = encrypt('hemligt');
    expect(ct.startsWith('v3:')).toBe(true);
    expect(decrypt(ct)).toBe('hemligt');

    lockCrypto();
    const unlock = await enrollOrUnlock('hunter2', deps);
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
    await enrollOrUnlock('correct', deps);
    await expect(changePassword('wrong', 'whatever', deps)).rejects.toThrow();
  });

  it('changePassword rotates the salt + wrapped key but not the recovery wrap', async () => {
    const { deps, peekBundle } = makeDeps();
    await enrollOrUnlock('p1', deps);
    const before = { ...peekBundle()! };

    await changePassword('p1', 'p2', deps);
    const after = peekBundle()!;

    expect(after.kdfSalt).not.toBe(before.kdfSalt);
    expect(after.wrappedDataKey).not.toBe(before.wrappedDataKey);
    // Recovery wrap is preserved (same dataKey).
    expect(after.recoveryWrappedDataKey).toBe(before.recoveryWrappedDataKey);
    expect(after.recoverySalt).toBe(before.recoverySalt);
  });

  it('recovery code still works after a password change', async () => {
    const { deps } = makeDeps();
    const enrol = await enrollOrUnlock('first', deps);
    const code = enrol.recoveryCode!;
    const ciphertext = encrypt('recover me');

    await changePassword('first', 'second', deps);

    lockCrypto();
    await recoverWithCode(code, deps);
    expect(decrypt(ciphertext)).toBe('recover me');
  });

  it('changePassword throws when not enrolled', async () => {
    const { deps } = makeDeps();
    await expect(changePassword('a', 'b', deps)).rejects.toThrow();
  });

  it('restoreFromDevice re-activates the key without a password', async () => {
    const { deps } = makeDeps();
    await enrollOrUnlock('pw', deps);
    const ct = encrypt('device restore');
    lockCrypto();

    const restored = await restoreFromDevice(deps);
    expect(restored).toBe(true);
    expect(decrypt(ct)).toBe('device restore');
  });
});
