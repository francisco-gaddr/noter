import {
  enrollOrUnlock,
  restoreFromDevice,
  recoverWithCode,
  lockCrypto,
  KEY_VERSION,
  type BootstrapDeps,
  type KeyBundle,
} from '../services/crypto/keyBootstrap';
import { encrypt, decrypt, safeDecrypt, setActiveDataKey, isV3 } from '@repo/shared';

jest.setTimeout(60000); // Argon2id derivation is intentionally slow

afterEach(() => setActiveDataKey(null));

function makeHarness() {
  let serverBundle: KeyBundle | null = null;
  const secure = new Map<string, string>();
  const deps: BootstrapDeps = {
    getBundle: async () => serverBundle,
    putBundle: async (b) => {
      serverBundle = b;
    },
    secureGetDataKey: async () => secure.get('dataKey') ?? null,
    secureSetDataKey: async (b64) => {
      secure.set('dataKey', b64);
    },
  };
  return { deps, peek: () => ({ serverBundle, secure }) };
}

describe('keyBootstrap', () => {
  it('enrols, stores an opaque wrapped key server-side, and activates v3 writes', async () => {
    const { deps, peek } = makeHarness();
    const result = await enrollOrUnlock('correct horse battery staple', deps);

    expect(result.result).toBe('enrolled');
    expect(result.recoveryCode).toMatch(/^[0-9A-Z-]+$/); // shown once
    const { serverBundle, secure } = peek();
    expect(serverBundle?.keyVersion).toBe(KEY_VERSION);
    expect(serverBundle?.wrappedDataKey.startsWith('v3w:')).toBe(true);
    expect(serverBundle?.recoveryWrappedDataKey?.startsWith('v3w:')).toBe(true);
    expect(secure.get('dataKey')).toBeTruthy();

    // writes now emit authenticated v3
    const c = encrypt('hemlig anteckning');
    expect(isV3(c)).toBe(true);
    expect(decrypt(c)).toBe('hemlig anteckning');
  });

  it('lets a second device unlock with the password and read enrolled content', async () => {
    const { deps } = makeHarness();
    await enrollOrUnlock('s3cret-pass', deps);
    const cipher = encrypt('cross-device note');
    setActiveDataKey(null); // simulate a fresh device with no in-memory key

    const result = await enrollOrUnlock('s3cret-pass', deps);
    expect(result.result).toBe('unlocked');
    expect(decrypt(cipher)).toBe('cross-device note');
  });

  it('recovers with the recovery code after a forgotten password', async () => {
    const { deps } = makeHarness();
    const { recoveryCode } = await enrollOrUnlock('forgotten-pw', deps);
    const cipher = encrypt('recover me');
    setActiveDataKey(null); // password forgotten, device key gone

    await recoverWithCode(recoveryCode!, deps);
    expect(decrypt(cipher)).toBe('recover me');
  });

  it('rejects a wrong recovery code', async () => {
    const { deps } = makeHarness();
    await enrollOrUnlock('pw', deps);
    setActiveDataKey(null);
    await expect(recoverWithCode('WRONG-CODE-0000-0000-0000', deps)).rejects.toThrow();
  });

  it('throws on the wrong password (auth tag fails) without activating', async () => {
    const { deps } = makeHarness();
    await enrollOrUnlock('right-password', deps);
    setActiveDataKey(null);

    await expect(enrollOrUnlock('wrong-password', deps)).rejects.toThrow();
  });

  it('restoreFromDevice re-activates from the Keychain backup with no password', async () => {
    const { deps } = makeHarness();
    await enrollOrUnlock('pw-123', deps);
    const cipher = encrypt('persisted note');
    setActiveDataKey(null);

    const restored = await restoreFromDevice(deps);
    expect(restored).toBe(true);
    expect(decrypt(cipher)).toBe('persisted note');
  });

  it('restoreFromDevice returns false when the device is not enrolled', async () => {
    const { deps } = makeHarness();
    expect(await restoreFromDevice(deps)).toBe(false);
  });

  it('after lockCrypto, v3 content is unreadable but legacy data still reads', async () => {
    const { deps } = makeHarness();
    // legacy data written before enrolment
    const legacy = encrypt('gammal note');
    await enrollOrUnlock('pw', deps);
    const v3 = encrypt('ny note');

    lockCrypto();
    expect(safeDecrypt(v3, 'LOCKED')).toBe('LOCKED'); // no blank, no leak
    expect(safeDecrypt(legacy)).toBe('gammal note'); // legacy always readable
  });
});
